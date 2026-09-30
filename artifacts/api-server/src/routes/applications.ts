import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { clerkClient } from "@clerk/express";
import { db, applicationsTable, applicationDocumentsTable, applicationDocumentAuditTable, statusHistoryTable, type Application } from "@workspace/db";
import { allowedDepartments, authorizedStaff, signedInUser, staffCanAccessDepartment } from "../lib/access";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { applicationDocumentStorage } from "../lib/applicationDocumentStorage";
import { cleanupApplicationDocuments, cleanupDocumentObject } from "../lib/applicationDocumentMaintenance";
import { databaseErrorCode, isDatabaseUnavailable, withDatabaseRetry } from "../lib/databaseResilience";
import { createDemoApplications, filterDemoApplications, isDemoApplicationId } from "../lib/applicationSamples";
import {
  CompleteApplicationDocumentUploadParams, CompleteApplicationDocumentUploadResponse,
  DeleteApplicationDocumentParams, DownloadApplicationDocumentParams, ListApplicationDocumentsParams,
  ListApplicationDocumentsResponse, ListApplicationHistoryParams, ListApplicationHistoryResponse,
  PostApplicationResponseBody, PostApplicationResponseParams, PostApplicationResponseResponse,
  RequestApplicationDocumentUploadBody, RequestApplicationDocumentUploadParams,
  RequestApplicationDocumentUploadResponse,
} from "@workspace/api-zod";
import {
  CreateApplicationBody, CreateApplicationResponse,
  ListMyApplicationsQueryParams, ListMyApplicationsResponse,
  SearchStaffApplicationsQueryParams, SearchStaffApplicationsResponse,
  UpdateMyApplicationBody, UpdateMyApplicationParams, UpdateMyApplicationResponse,
  ReviewApplicationBody, ReviewApplicationParams, ReviewApplicationResponse,
  GetStaffAccessResponse, UpdateStaffAccessBody, UpdateStaffAccessResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const statuses = new Set([
  "Draft", "Draft — Requires Review", "In Review (Re-opened)",
  "Approved", "Rejected", "Modified via Staff Override",
]);
const completed = new Set(["Approved", "Rejected", "Modified via Staff Override"]);

const currentUser = signedInUser;
const documentTypes = new Set(["application/pdf", "image/png", "image/jpeg"]);

function staffAccessResponse(staff: { administratorEnabled: boolean; department: string }) {
  return {
    administratorEnabled: staff.administratorEnabled,
    assignedDepartment: staff.department,
    accessibleDepartments: staff.administratorEnabled || staff.department === "Economic Development"
      ? [...allowedDepartments]
      : [staff.department],
  };
}

function sameOriginCookieMutation(req: Request): boolean {
  const origin = req.get("origin");
  const trustedHost = getClerkProxyHost(req);
  if (!origin || !trustedHost) return false;
  try {
    const parsed = new URL(origin);
    const forwardedProtocol = req.headers["x-forwarded-proto"];
    const firstForwardedProtocol = (Array.isArray(forwardedProtocol)
      ? forwardedProtocol[0]
      : forwardedProtocol)?.split(",")[0]?.trim().toLowerCase();
    const trustedProtocol = firstForwardedProtocol || req.protocol.toLowerCase();
    return (trustedProtocol === "https" || trustedProtocol === "http")
      && parsed.protocol === `${trustedProtocol}:`
      && parsed.host.toLowerCase() === trustedHost.toLowerCase()
      && parsed.origin === origin;
  } catch {
    return false;
  }
}

router.get("/staff/access", async (req, res): Promise<void> => {
  const staff = await authorizedStaff(req, res);
  if (!staff) return;
  res.setHeader("Cache-Control", "no-store");
  res.json(GetStaffAccessResponse.parse(staffAccessResponse(staff)));
});

router.put("/staff/access", async (req, res): Promise<void> => {
  const staff = await authorizedStaff(req, res);
  if (!staff) return;
  if (!sameOriginCookieMutation(req)) {
    res.status(403).json({ error: "Administrator access changes require a same-origin request." });
    return;
  }
  const body = UpdateStaffAccessBody.safeParse(req.body);
  if (!body.success || !req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
      Object.keys(req.body).some(key => key !== "administratorEnabled")) {
    res.status(400).json({ error: "Set administratorEnabled to true or false." });
    return;
  }

  try {
    await clerkClient.users.updateUserMetadata(staff.id, {
      privateMetadata: { staffAdministratorEnabled: body.data.administratorEnabled },
    });
  } catch {
    req.log?.warn({ staffUserId: staff.id, department: staff.department }, "Could not update staff administrator access");
    res.status(503).json({ error: "Staff permissions could not be updated. Your current permissions remain unchanged." });
    return;
  }
  req.log?.info({
    staffUserId: staff.id,
    department: staff.department,
    administratorEnabled: body.data.administratorEnabled,
  }, "Staff administrator access changed");
  res.setHeader("Cache-Control", "no-store");
  res.json(UpdateStaffAccessResponse.parse({
    administratorEnabled: body.data.administratorEnabled,
    assignedDepartment: staff.department,
    accessibleDepartments: body.data.administratorEnabled || staff.department === "Economic Development"
      ? [...allowedDepartments]
      : [staff.department],
  }));
});

function documentView(document: typeof applicationDocumentsTable.$inferSelect) {
  return {
    id: document.id,
    name: document.name,
    size: document.size,
    contentType: document.contentType,
    state: document.state,
    uploadedAt: document.uploadedAt,
  };
}

function documentAuditValues(applicationId: string, documentId: string | null, actorId: string, action: string, department: string | null = null) {
  return {
    id: crypto.randomUUID(), applicationId, documentId, actorId, actorDepartment: department, action,
  };
}

async function auditDocument(applicationId: string, documentId: string | null, actorId: string, action: string, department: string | null = null) {
  await db.insert(applicationDocumentAuditTable).values(documentAuditValues(applicationId, documentId, actorId, action, department));
}

async function ownedDraftApplication(req: Request, res: Response, applicationId: string): Promise<{ application: Application; userId: string } | null> {
  const access = await ownedApplication(req, res, applicationId);
  if (!access) return null;
  if (access.application.sourceUrl || access.application.status !== "Draft" || access.application.submittedAt) {
    res.status(403).json({ error: "Documents can only be changed on an unsubmitted draft application." });
    return null;
  }
  return access;
}

async function ownedApplication(req: Request, res: Response, applicationId: string): Promise<{ application: Application; userId: string } | null> {
  const userId = currentUser(req, res);
  if (!userId) return null;
  const [application] = await db.select().from(applicationsTable).where(and(
    eq(applicationsTable.id, applicationId), eq(applicationsTable.ownerId, userId),
  ));
  if (!application) { res.status(404).json({ error: "Application not found." }); return null; }
  return { application, userId };
}

async function readableApplication(req: Request, res: Response, applicationId: string): Promise<{ application: Application; actorId: string; department: string | null } | null> {
  const userId = currentUser(req, res);
  if (!userId) return null;
  if (isDemoApplicationId(applicationId)) {
    res.status(404).json({ error: "Application not found." });
    return null;
  }
  const [application] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, applicationId));
  if (!application || application.sourceUrl) {
    res.status(404).json({ error: "Application not found." });
    return null;
  }
  if (application.ownerId === userId) return { application, actorId: userId, department: null };
  const staff = await authorizedStaff(req, res);
  if (!staff) return null;
  if (!application.submittedAt ||
      !application.assignedDepartment.split(",").some(department =>
        staffCanAccessDepartment(staff, department.trim()))) {
    res.status(404).json({ error: "Submitted application not found for this department." });
    return null;
  }
  return { application, actorId: staff.id, department: staff.department };
}

function hasValidSignature(contentType: string, signature: Buffer): boolean {
  if (contentType === "application/pdf") return signature.subarray(0, 5).toString("ascii") === "%PDF-";
  if (contentType === "image/png") return signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === "image/jpeg") return signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
  return false;
}

function safeDisposition(name: string, download: boolean): string {
  const asciiName = name.replace(/[^\x20-\x7e]|["\\]/g, "_") || "document";
  const encodedName = encodeURIComponent(name).replace(/['()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

router.get("/applications/:id/documents", async (req, res): Promise<void> => {
  const params = ListApplicationDocumentsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid application ID." }); return; }
  const access = await readableApplication(req, res, params.data.id);
  if (!access) return;
  await cleanupApplicationDocuments(access.application.id);
  const rows = await db.select().from(applicationDocumentsTable).where(and(
    eq(applicationDocumentsTable.applicationId, access.application.id),
    inArray(applicationDocumentsTable.state, ["pending", "ready"]),
  ));
  await auditDocument(access.application.id, null, access.actorId, "list", access.department);
  res.json(ListApplicationDocumentsResponse.parse(rows.map(documentView)));
});

router.post("/applications/:id/documents/upload-url", async (req, res): Promise<void> => {
  const params = RequestApplicationDocumentUploadParams.safeParse(req.params);
  const body = RequestApplicationDocumentUploadBody.safeParse(req.body);
  if (!params.success || !body.success || !body.data.name.trim()) {
    res.status(400).json({ error: "Invalid document name, size, or content type." }); return;
  }
  const access = await ownedDraftApplication(req, res, params.data.id);
  if (!access) return;
  const documentId = crypto.randomUUID();
  const stagingObjectId = crypto.randomUUID();
  const finalObjectId = crypto.randomUUID();
  const name = body.data.name.trim();
  const uploadExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const { url: uploadUrl, expiresAt: uploadUrlExpiresAt } =
    await applicationDocumentStorage.createUploadUrl(stagingObjectId, body.data.contentType);
  await cleanupApplicationDocuments(access.application.id);
  const reserved = await db.transaction(async tx => {
    const [lockedApplication] = await tx.select().from(applicationsTable)
      .where(eq(applicationsTable.id, access.application.id)).for("update");
    if (!lockedApplication || lockedApplication.ownerId !== access.userId ||
        lockedApplication.status !== "Draft" || lockedApplication.submittedAt) return null;
    const activeDocuments = await tx.select().from(applicationDocumentsTable)
      .where(eq(applicationDocumentsTable.applicationId, lockedApplication.id));
    if (activeDocuments.filter(document =>
      document.state === "ready" || (document.state === "pending" && document.uploadExpiresAt > new Date()),
    ).length >= 20) return false;
    const [row] = await tx.insert(applicationDocumentsTable).values({
      id: documentId, applicationId: lockedApplication.id, name, size: body.data.size,
      contentType: body.data.contentType, stagingObjectId, finalObjectId, uploadExpiresAt, uploadUrlExpiresAt,
    }).returning();
    await tx.insert(applicationDocumentAuditTable).values(documentAuditValues(
      lockedApplication.id, documentId, access.userId, "upload-reserved",
    ));
    return row;
  });
  if (reserved === null) { res.status(403).json({ error: "Documents can only be changed on an unsubmitted draft application." }); return; }
  if (reserved === false) { res.status(400).json({ error: "An application can have at most 20 documents." }); return; }
  res.status(201).json(RequestApplicationDocumentUploadResponse.parse({
    uploadUrl, document: documentView(reserved),
  }));
});

router.post("/applications/:id/documents/:documentId/complete", async (req, res): Promise<void> => {
  const params = CompleteApplicationDocumentUploadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid document ID." }); return; }
  const access = await ownedApplication(req, res, params.data.id);
  if (!access) return;
  await cleanupApplicationDocuments(access.application.id);
  const [document] = await db.select().from(applicationDocumentsTable).where(and(
    eq(applicationDocumentsTable.id, params.data.documentId),
    eq(applicationDocumentsTable.applicationId, access.application.id),
    inArray(applicationDocumentsTable.state, ["pending", "ready"]),
  ));
  if (!document) { res.status(404).json({ error: "Document not found." }); return; }
  if (document.state === "ready") {
    res.json(CompleteApplicationDocumentUploadResponse.parse(documentView(document)));
    return;
  }
  if (document.uploadExpiresAt <= new Date()) {
    res.status(410).json({ error: "The document upload reservation has expired." });
    return;
  }
  if (access.application.sourceUrl || access.application.status !== "Draft" || access.application.submittedAt) {
    res.status(403).json({ error: "Documents can only be changed on an unsubmitted draft application." });
    return;
  }
  let actual: Awaited<ReturnType<typeof applicationDocumentStorage.inspect>>;
  try {
    actual = await applicationDocumentStorage.inspect(document.stagingObjectId);
  } catch (error) {
    const [latest] = await db.select({
      state: applicationDocumentsTable.state,
      uploadExpiresAt: applicationDocumentsTable.uploadExpiresAt,
    }).from(applicationDocumentsTable).where(eq(applicationDocumentsTable.id, document.id));
    if (latest?.state === "deleting") {
      const expired = latest.uploadExpiresAt <= new Date();
      res.status(expired ? 410 : 409).json({
        error: expired ? "The document upload reservation has expired." : "The document upload was canceled.",
      });
      return;
    }
    if (!latest) { res.status(404).json({ error: "Document not found." }); return; }
    throw error;
  }
  const validUpload = actual.size === document.size && actual.contentType === document.contentType &&
    documentTypes.has(actual.contentType) && hasValidSignature(actual.contentType, actual.signature);
  const result = await db.transaction(async tx => {
    const [currentApplication] = await tx.select().from(applicationsTable)
      .where(eq(applicationsTable.id, access.application.id)).for("update");
    if (!currentApplication || currentApplication.ownerId !== access.userId ||
        currentApplication.status !== "Draft" || currentApplication.submittedAt || currentApplication.sourceUrl) {
      return "not-draft" as const;
    }
    const [currentDocument] = await tx.select().from(applicationDocumentsTable).where(and(
      eq(applicationDocumentsTable.id, document.id),
      eq(applicationDocumentsTable.applicationId, currentApplication.id),
    )).for("update");
    if (!currentDocument) return "missing" as const;
    if (currentDocument.state === "deleting") {
      return currentDocument.uploadExpiresAt <= new Date() ? "expired" as const : "missing" as const;
    }
    if (currentDocument.state === "ready") return { kind: "ready" as const, document: currentDocument };
    if (currentDocument.uploadExpiresAt <= new Date()) {
      const [tombstone] = await tx.update(applicationDocumentsTable).set({
        state: "deleting", stagingCleanedAt: null,
      }).where(and(
        eq(applicationDocumentsTable.id, currentDocument.id),
        eq(applicationDocumentsTable.state, "pending"),
        lte(applicationDocumentsTable.uploadExpiresAt, new Date()),
      )).returning();
      if (!tombstone) return "conflict" as const;
      await tx.insert(applicationDocumentAuditTable).values(documentAuditValues(
        currentDocument.applicationId, currentDocument.id, "system:document-cleanup", "reservation-expired",
      ));
      return { kind: "expired" as const, document: tombstone };
    }
    if (!validUpload) {
      const [tombstone] = await tx.update(applicationDocumentsTable).set({
        state: "deleting", stagingCleanedAt: null,
      }).where(and(
        eq(applicationDocumentsTable.id, currentDocument.id),
        eq(applicationDocumentsTable.state, "pending"),
      )).returning();
      if (!tombstone) return "conflict" as const;
      await tx.insert(applicationDocumentAuditTable).values(documentAuditValues(
        currentDocument.applicationId, currentDocument.id, access.userId, "upload-rejected",
      ));
      return { kind: "invalid" as const, document: tombstone };
    }
    const finalGeneration = await applicationDocumentStorage.promote(
      currentDocument.stagingObjectId, currentDocument.finalObjectId, actual.generation, currentDocument.id,
    );
    const [ready] = await tx.update(applicationDocumentsTable).set({
      state: "ready", finalGeneration, uploadedAt: new Date(),
    }).where(and(
      eq(applicationDocumentsTable.id, currentDocument.id),
      eq(applicationDocumentsTable.state, "pending"),
    )).returning();
    if (!ready) {
      const [reloaded] = await tx.select().from(applicationDocumentsTable).where(eq(
        applicationDocumentsTable.id, currentDocument.id,
      )).for("update");
      if (reloaded?.state === "ready") return { kind: "ready" as const, document: reloaded };
      return "conflict" as const;
    }
    await tx.insert(applicationDocumentAuditTable).values(documentAuditValues(
      currentDocument.applicationId, currentDocument.id, access.userId, "upload-completed",
    ));
    return { kind: "ready" as const, document: ready };
  });
  if (result === "not-draft") { res.status(403).json({ error: "Documents can only be changed on an unsubmitted draft application." }); return; }
  if (result === "missing") { res.status(404).json({ error: "Document not found." }); return; }
  if (result === "expired") { res.status(410).json({ error: "The document upload reservation has expired." }); return; }
  if (result === "conflict") { res.status(409).json({ error: "The upload changed or expired while it was being completed. Refresh the document list and retry." }); return; }
  if (typeof result === "object" && result.kind === "expired") {
    await cleanupDocumentObject(result.document);
    res.status(410).json({ error: "The document upload reservation has expired." });
    return;
  }
  if (typeof result === "object" && result.kind === "invalid") {
    await cleanupDocumentObject(result.document);
    res.status(400).json({ error: "Uploaded document size, content type, or file signature is invalid." });
    return;
  }
  const readyDocument = typeof result === "object" ? result.document : null;
  if (!readyDocument) { res.status(404).json({ error: "Document not found." }); return; }
  await cleanupDocumentObject(readyDocument);
  res.json(CompleteApplicationDocumentUploadResponse.parse(documentView(readyDocument)));
});

router.delete("/applications/:id/documents/:documentId", async (req, res): Promise<void> => {
  const params = DeleteApplicationDocumentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid document ID." }); return; }
  const access = await ownedDraftApplication(req, res, params.data.id);
  if (!access) return;
  await cleanupApplicationDocuments(access.application.id);
  const result = await db.transaction(async tx => {
    const [currentApplication] = await tx.select().from(applicationsTable)
      .where(eq(applicationsTable.id, access.application.id)).for("update");
    if (!currentApplication || currentApplication.ownerId !== access.userId ||
        currentApplication.status !== "Draft" || currentApplication.submittedAt || currentApplication.sourceUrl) return "not-draft" as const;
    const [document] = await tx.select().from(applicationDocumentsTable).where(and(
      eq(applicationDocumentsTable.id, params.data.documentId),
      eq(applicationDocumentsTable.applicationId, currentApplication.id),
    )).for("update");
    if (!document) return "missing" as const;
    if (document.state === "deleting") return document;
    const [tombstone] = await tx.update(applicationDocumentsTable).set({
      state: "deleting", stagingCleanedAt: null,
    }).where(eq(applicationDocumentsTable.id, document.id)).returning();
    await tx.insert(applicationDocumentAuditTable).values(documentAuditValues(
      document.applicationId, document.id, access.userId, "deleted",
    ));
    return tombstone;
  });
  if (result === "not-draft") { res.status(403).json({ error: "Documents can only be changed on an unsubmitted draft application." }); return; }
  if (result === "missing") { res.status(404).json({ error: "Document not found." }); return; }
  if (typeof result !== "string") await cleanupDocumentObject(result);
  res.status(204).end();
});

router.get("/applications/:id/documents/:documentId/content", async (req, res): Promise<void> => {
  const params = DownloadApplicationDocumentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid document ID." }); return; }
  const access = await readableApplication(req, res, params.data.id);
  if (!access) return;
  await cleanupApplicationDocuments(access.application.id);
  const [document] = await db.select().from(applicationDocumentsTable).where(and(
    eq(applicationDocumentsTable.id, params.data.documentId),
    eq(applicationDocumentsTable.applicationId, access.application.id),
    eq(applicationDocumentsTable.state, "ready"),
  ));
  if (!document) { res.status(404).json({ error: "Document not found." }); return; }
  await auditDocument(access.application.id, document.id, access.actorId, "content-read", access.department);
  res.set({
    "Content-Type": document.contentType,
    "Content-Length": String(document.size),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": safeDisposition(document.name, req.query.download === "1" || req.query.download === "true"),
  });
  const stream = applicationDocumentStorage.open(document.finalObjectId, document.finalGeneration!);
  stream.on("error", error => {
    req.log.error({ err: error, documentId: document.id }, "Failed to stream protected application document");
    if (res.headersSent) res.destroy(error);
    else res.status(404).json({ error: "Document content is unavailable." });
  });
  stream.pipe(res);
});

function parsePlan(value: Record<string, unknown>): { intake: Record<string, unknown>; status: string; language: string; matched: string[]; departments: string[] } | null {
  const intake = value.intake;
  if (!intake || typeof intake !== "object" || Array.isArray(intake)) return null;
  const details = intake as Record<string, unknown>;
  const contactLimits = { applicantName: 200, applicantEmail: 254, applicantPhone: 40 };
  for (const [field, maxLength] of Object.entries(contactLimits)) {
    const contact = details[field];
    if (contact !== undefined && (typeof contact !== "string" || contact.length > maxLength)) return null;
  }
  if (typeof details.applicantEmail === "string" && details.applicantEmail.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.applicantEmail.trim())) return null;
  if (typeof details.address !== "string" || typeof details.description !== "string" ||
      typeof details.businessType !== "string" || !Array.isArray(details.modifications) ||
      !details.modifications.every(modification => typeof modification === "string") ||
      !Array.isArray(value.matched) || !value.matched.every(match => typeof match === "string") ||
      typeof value.status !== "string" || !statuses.has(value.status) ||
      typeof value.language !== "string") return null;
  return {
    intake: details,
    status: value.status,
    language: value.language,
    matched: value.matched as string[],
    departments: Array.isArray(value.departments) ? value.departments.filter((item): item is string => typeof item === "string") : ["Planning"],
  };
}

function fieldsFromPlan(value: Record<string, unknown>) {
  const parsed = parsePlan(value);
  if (!parsed) return null;
  const { intake, matched, departments } = parsed;
  const businessName = typeof intake.businessName === "string" && intake.businessName.trim()
    ? intake.businessName.trim()
    : typeof intake.address === "string" && intake.address.trim() ? `Business at ${intake.address}` : "Unnamed business";
  const requestType = matched.includes("building-permits") ? "Building Permit"
    : matched.includes("sign-permits") ? "Sign Permit"
    : matched.includes("health-safety") ? "Health & Safety Review"
    : matched.includes("business-registration") ? "Business Registration"
    : "General Permit Review";
  const notes = value.notes && typeof value.notes === "object"
    ? Object.values(value.notes).filter((item): item is string => typeof item === "string" && !!item.trim()).join(" · ") || null
    : null;
  return {
    businessName,
    businessCategory: intake.businessType === "other" && typeof intake.businessOther === "string" ? intake.businessOther : String(intake.businessType),
    requestType,
    status: parsed.status,
    assignedDepartment: departments.length ? departments.join(", ") : "Planning",
    applicantLanguage: parsed.language === "other" && typeof value.customLanguage === "string" ? value.customLanguage : ({
      en: "English", es: "Spanish", vi: "Vietnamese", zh: "Chinese", tl: "Tagalog",
    } as Record<string, string>)[parsed.language] || parsed.language,
    description: String(intake.description),
    notes,
  };
}

function respond(record: Application, includeApplicantPlanUserId = true) {
  const { ownerId: _ownerId, applicantKey: _applicantKey, ...publicRecord } = record;
  if (includeApplicantPlanUserId) return publicRecord;
  // Applicants use this composite value to identify their own plans; reviewers do not need it.
  const plan = { ...record.plan };
  delete plan.userId;
  return { ...publicRecord, plan };
}

function reportDatabaseListFailure(req: Request, res: Response, error: unknown, mode: "mine" | "staff"): void {
  const code = databaseErrorCode(error);
  if (isDatabaseUnavailable(error)) {
    req.log?.warn({ code, mode }, "Permit application database is unavailable");
    if (mode === "staff") {
      const department = res.locals["authorizedStaffDepartment"] as string;
      const filters = res.locals["validatedStaffFilters"] as Record<string, string | undefined>;
      const now = new Date();
      const rows = filterDemoApplications(createDemoApplications(now), department, filters).map(record => ({
        ...respond(record, false),
        plan: { ...record.plan, _dataSource: "sample-fallback" },
      }));
      if (rows.length === 0) {
        res.setHeader("Retry-After", "30");
        res.status(503).json({ error: "The database is unavailable and no sample applications match these filters." });
        return;
      }
      res.setHeader("X-Application-Data-Source", "sample-fallback");
      res.setHeader("Retry-After", "30");
      res.status(200).json(SearchStaffApplicationsResponse.parse(rows));
      return;
    }
    res.setHeader("Retry-After", "30");
    res.status(503).json({ error: "Application storage is temporarily unavailable. Please retry shortly." });
    return;
  }
  req.log?.error({ code, mode }, "Unexpected permit application list failure");
  res.status(500).json({ error: "Could not load applications." });
}

router.get("/applications/mine", async (req, res): Promise<void> => {
  const userId = currentUser(req, res);
  if (!userId) return;
  const query = ListMyApplicationsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "An applicant key is required." }); return; }
  const key = query.data.applicantKey.trim().toLowerCase();
  if (!key) { res.status(400).json({ error: "An applicant key is required." }); return; }
  try {
    const rows = await withDatabaseRetry(() => db.select().from(applicationsTable).where(and(
      eq(applicationsTable.ownerId, userId), eq(applicationsTable.applicantKey, key),
    )).orderBy(desc(applicationsTable.updatedAt)).limit(100));
    res.json(ListMyApplicationsResponse.parse(rows.map(row => respond(row))));
  } catch (error) {
    reportDatabaseListFailure(req, res, error, "mine");
  }
});

router.get(["/applications/staff", "/applications"], async (req, res): Promise<void> => {
  const staff = await authorizedStaff(req, res);
  if (!staff) return;
  const rawQuery = {
    ...req.query,
    ...(typeof req.query.submissionDate === "string"
      ? { submissionDate: new Date(req.query.submissionDate) }
      : {}),
  };
  const query = SearchStaffApplicationsQueryParams.safeParse(rawQuery);
  if (!query.success) { res.status(400).json({ error: "Invalid search filters." }); return; }
  const filters = {
    ...query.data,
    ...(query.data.submissionDate
      ? { submissionDate: query.data.submissionDate.toISOString().slice(0, 10) }
      : {}),
  } as Record<string, string | undefined>;
  res.locals["authorizedStaffDepartment"] = staff.administratorEnabled ? "Economic Development" : staff.department;
  res.locals["validatedStaffFilters"] = filters;
  // Staff queue contains submitted applications only; unsent drafts stay private.
  const conditions: SQL[] = [or(isNotNull(applicationsTable.submittedAt), isNotNull(applicationsTable.sourceUrl))!];
  if (!staff.administratorEnabled && staff.department !== "Economic Development") {
    conditions.push(or(
      ilike(applicationsTable.assignedDepartment, `%${staff.department}%`),
      isNotNull(applicationsTable.sourceUrl),
    )!);
  }
  const searchColumns: Array<[string | undefined, AnyPgColumn]> = [
    [query.data.applicationId, applicationsTable.id],
    [query.data.businessName, applicationsTable.businessName],
    [query.data.businessCategory, applicationsTable.businessCategory],
    [query.data.requestType, applicationsTable.requestType],
    [query.data.status, applicationsTable.status],
    [query.data.assignedDepartment, applicationsTable.assignedDepartment],
    [query.data.applicantLanguage, applicationsTable.applicantLanguage],
  ];
  for (const [term, column] of searchColumns) {
    if (term?.trim()) conditions.push(ilike(column, `%${term.trim().replace(/[\\%_]/g, "\\$&")}%`));
  }
  if (query.data.submissionDate) {
    const start = new Date(query.data.submissionDate);
    if (Number.isNaN(start.getTime())) {
      res.status(400).json({ error: "Invalid submission date." }); return;
    }
    const dayStart = new Date(`${start.toISOString().slice(0, 10)}T00:00:00.000Z`);
    conditions.push(gte(applicationsTable.submittedAt, dayStart), lt(applicationsTable.submittedAt, new Date(dayStart.getTime() + 86_400_000)));
  }
  if (query.data.descriptionOrNotes?.trim()) {
    const term = `%${query.data.descriptionOrNotes.trim().replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(ilike(applicationsTable.description, term), ilike(applicationsTable.notes, term))!);
  }
  if (query.data.search?.trim()) {
    const term = `%${query.data.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(...[
      applicationsTable.id, applicationsTable.businessName, applicationsTable.businessCategory,
      applicationsTable.requestType, applicationsTable.status, applicationsTable.assignedDepartment,
      applicationsTable.applicantLanguage, applicationsTable.description, applicationsTable.notes,
    ].map(column => ilike(column, term)))!);
  }
  try {
    const rows = await withDatabaseRetry(() => db.select().from(applicationsTable).where(and(...conditions))
      .orderBy(desc(sql`coalesce(${applicationsTable.submittedAt}, ${applicationsTable.sourceDate})`)).limit(500));
    res.json(SearchStaffApplicationsResponse.parse(rows.map(row => respond(row, false))));
  } catch (error) {
    reportDatabaseListFailure(req, res, error, "staff");
  }
});

router.post("/applications", async (req, res): Promise<void> => {
  const userId = currentUser(req, res);
  if (!userId) return;
  const body = CreateApplicationBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid application." }); return; }
  const fields = fieldsFromPlan(body.data.plan);
  if (!fields) { res.status(400).json({ error: "Incomplete application plan." }); return; }
  const id = crypto.randomUUID();
  const now = new Date();
  const urgent = /\b(?:chemical spill|hazmat|toxic leak|gas leak|active fire|electrical fire|immediate danger|safety hazard|derrame qu[ií]mico|fuga de gas|incendio activo)\b/i.test(fields.description);
  const plan = { ...body.data.plan, id, userId: `${userId}:${body.data.applicantKey.trim().toLowerCase()}`, intake: { ...(body.data.plan.intake as object), files: [] } };
  const [row] = await db.insert(applicationsTable).values({
    id, ownerId: userId, applicantKey: body.data.applicantKey.trim().toLowerCase(),
    ...fields, assignedDepartment: urgent ? "Fire" : fields.assignedDepartment,
    synthetic: true, plan, submittedAt: fields.status === "Draft" && !urgent ? null : now,
  }).returning();
  await db.insert(statusHistoryTable).values({
    id: crypto.randomUUID(), applicationId: id, status: urgent ? "High Urgency — Human Review" : fields.status,
    actor: "Applicant", synthetic: true,
  });
  res.status(201).json(CreateApplicationResponse.parse(respond(row)));
});

router.patch("/applications/:id", async (req, res): Promise<void> => {
  const userId = currentUser(req, res);
  if (!userId) return;
  const params = UpdateMyApplicationParams.safeParse(req.params);
  const body = UpdateMyApplicationBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid application update." }); return; }
  const key = body.data.applicantKey.trim().toLowerCase();
  const fields = fieldsFromPlan(body.data.plan);
  if (!fields || !["Draft", "Draft — Requires Review"].includes(fields.status)) {
    res.status(400).json({ error: "This application cannot be changed in its current status." }); return;
  }
  const result = await db.transaction(async tx => {
    const [existing] = await tx.select().from(applicationsTable).where(and(
      eq(applicationsTable.id, params.data.id),
      eq(applicationsTable.ownerId, userId),
      eq(applicationsTable.applicantKey, key),
    )).for("update");
    if (!existing) return { kind: "missing" as const };
    if (body.data.expectedUpdatedAt && existing.updatedAt.getTime() !== body.data.expectedUpdatedAt.getTime()) {
      return { kind: "stale" as const };
    }
    if (existing.status !== "Draft" || existing.submittedAt || existing.sourceUrl) {
      return { kind: "not-editable" as const };
    }
    if (fields.status !== "Draft") {
      const [pending] = await tx.select({ value: count() }).from(applicationDocumentsTable).where(and(
        eq(applicationDocumentsTable.applicationId, existing.id),
        eq(applicationDocumentsTable.state, "pending"),
        gte(applicationDocumentsTable.uploadExpiresAt, new Date()),
      ));
      if (pending.value > 0) return { kind: "pending-documents" as const };
    }
    const proposed = body.data.plan;
    const now = new Date();
    const plan = {
      ...existing.plan,
      ...proposed,
      id: existing.id,
      userId: `${userId}:${key}`,
      intake: { ...(proposed.intake as object), files: [] },
      updatedAt: now.getTime(),
    };
    const [row] = await tx.update(applicationsTable).set({
      ...fields,
      plan,
      updatedAt: now,
      submittedAt: fields.status === "Draft" ? null : now,
    }).where(eq(applicationsTable.id, existing.id)).returning();
    if (row.status !== existing.status) await tx.insert(statusHistoryTable).values({
      id: crypto.randomUUID(),
      applicationId: row.id,
      status: row.status,
      actor: "Applicant",
      synthetic: row.synthetic,
    });
    return { kind: "updated" as const, row };
  });
  if (result.kind === "missing") { res.status(404).json({ error: "Application not found." }); return; }
  if (result.kind === "stale") { res.status(409).json({ error: "This application changed since it was last loaded. Refresh before saving." }); return; }
  if (result.kind === "pending-documents") { res.status(409).json({ error: "Complete or remove pending document uploads before submitting this application." }); return; }
  if (result.kind === "not-editable") { res.status(409).json({ error: "This application is no longer an unsubmitted draft." }); return; }
  const { row } = result;
  res.json(UpdateMyApplicationResponse.parse(respond(row)));
});

router.patch("/applications/:id/review", async (req, res): Promise<void> => {
  const staff = await authorizedStaff(req, res);
  if (!staff) return;
  const params = ReviewApplicationParams.safeParse(req.params);
  const body = ReviewApplicationBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid review update." }); return; }
  if (isDemoApplicationId(params.data.id)) {
    res.status(409).json({ error: "Sample fallback records are read-only." }); return;
  }
  const result = await db.transaction(async tx => {
    const [existing] = await tx.select().from(applicationsTable)
      .where(eq(applicationsTable.id, params.data.id)).for("update");
    if (!existing || !existing.submittedAt || !!existing.sourceUrl ||
        !existing.assignedDepartment.split(",").some(department =>
          staffCanAccessDepartment(staff, department.trim()))) {
      return { kind: "not-assigned" as const };
    }
    if (body.data.expectedUpdatedAt && existing.updatedAt.getTime() !== body.data.expectedUpdatedAt.getTime()) {
      return { kind: "stale" as const };
    }
    const proposed = body.data.plan;
    const status = typeof proposed.status === "string" ? proposed.status : existing.status;
    if (!statuses.has(status) || status === "Draft" ||
        (completed.has(existing.status) && status !== "In Review (Re-opened)")) {
      return { kind: "invalid-status" as const };
    }
    const proposedNotes = {
      ...(existing.plan.notes && typeof existing.plan.notes === "object" && !Array.isArray(existing.plan.notes) ? existing.plan.notes : {}),
      ...(proposed.notes && typeof proposed.notes === "object" && !Array.isArray(proposed.notes) ? proposed.notes : {}),
    } as Record<string, unknown>;
    delete proposedNotes._staff_response;
    const plan = { ...existing.plan, status,
      notes: proposedNotes,
      overrides: proposed.overrides && typeof proposed.overrides === "object" && !Array.isArray(proposed.overrides) ? proposed.overrides : existing.plan.overrides,
      rejected: Array.isArray(proposed.rejected) && proposed.rejected.every(item => typeof item === "string") ? proposed.rejected : existing.plan.rejected,
      completedAt: completed.has(status) ? Date.now() : null, updatedAt: Date.now(),
    };
    const fields = fieldsFromPlan(plan);
    if (!fields) return { kind: "invalid-plan" as const };
    const planWithCurrentResponse = sql<Record<string, unknown>>`
      ${JSON.stringify(plan)}::jsonb ||
      jsonb_build_object('notes', ${JSON.stringify(proposedNotes)}::jsonb ||
        CASE WHEN jsonb_typeof(${applicationsTable.plan}->'notes'->'_staff_response') = 'string'
          THEN jsonb_build_object('_staff_response', ${applicationsTable.plan}->'notes'->'_staff_response')
          ELSE '{}'::jsonb END)`;
    const [row] = await tx.update(applicationsTable).set({
      plan: planWithCurrentResponse, status, notes: fields.notes, updatedAt: new Date(),
    }).where(eq(applicationsTable.id, existing.id)).returning();
    await tx.insert(statusHistoryTable).values({
      id: crypto.randomUUID(), applicationId: row.id, status: row.status,
      actor: `Staff · ${staff.department}`, synthetic: row.synthetic,
    });
    return { kind: "reviewed" as const, row };
  });
  if (result.kind === "not-assigned") { res.status(404).json({ error: "Submitted application not found for this department." }); return; }
  if (result.kind === "stale") { res.status(409).json({ error: "This application changed since it was last loaded. Refresh before reviewing." }); return; }
  if (result.kind === "invalid-status" || result.kind === "invalid-plan") {
    res.status(400).json({ error: result.kind === "invalid-status" ? "Invalid review status." : "Invalid stored plan." });
    return;
  }
  res.json(ReviewApplicationResponse.parse(respond(result.row)));
});

router.post("/applications/:id/response", async (req, res): Promise<void> => {
  const staff = await authorizedStaff(req, res);
  if (!staff) return;
  const params = ListApplicationHistoryParams.safeParse(req.params);
  const body = PostApplicationResponseBody.safeParse(req.body);
  if (!params.success || !body.success || !body.data.text.trim()) {
    res.status(400).json({ error: "A response of up to 3000 characters is required." }); return;
  }
  if (isDemoApplicationId(params.data.id)) {
    res.status(409).json({ error: "Sample fallback records are read-only." }); return;
  }
  const [existing] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, params.data.id));
  if (!existing || !existing.submittedAt || !!existing.sourceUrl ||
      !existing.assignedDepartment.split(",").some(department =>
        staffCanAccessDepartment(staff, department.trim()))) {
    res.status(404).json({ error: "Submitted application not found for this department." }); return;
  }
  const text = body.data.text.trim();
  const row = await db.transaction(async tx => {
    const [updated] = await tx.update(applicationsTable).set({
      plan: sql<Record<string, unknown>>`jsonb_set(${applicationsTable.plan}, '{notes}',
        (CASE WHEN jsonb_typeof(${applicationsTable.plan}->'notes') = 'object'
          THEN ${applicationsTable.plan}->'notes' ELSE '{}'::jsonb END) ||
        jsonb_build_object('_staff_response', ${text}::text), true)`,
      updatedAt: new Date(),
    }).where(eq(applicationsTable.id, existing.id)).returning();
    await tx.insert(statusHistoryTable).values({
      id: crypto.randomUUID(), applicationId: updated.id,
      status: "Response posted to applicant plan",
      actor: `Staff · ${staff.department}`, synthetic: updated.synthetic,
    });
    return updated;
  });
  res.json(PostApplicationResponseResponse.parse(respond(row, false)));
});

router.get("/applications/:id/history", async (req, res): Promise<void> => {
  const userId = currentUser(req, res);
  if (!userId) return;
  const params = ListApplicationHistoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid application ID." }); return; }
  if (isDemoApplicationId(params.data.id)) {
    res.status(404).json({ error: "Application not found." });
    return;
  }
  const [application] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, params.data.id));
  if (!application) { res.status(404).json({ error: "Application not found." }); return; }
  if (application.ownerId !== userId) {
    const staff = await authorizedStaff(req, res);
    if (!staff) return;
    if (!application.submittedAt) {
      res.status(403).json({ error: "Only submitted application history is available to staff." }); return;
    }
    if (!application.assignedDepartment.split(",").some(department =>
      staffCanAccessDepartment(staff, department.trim()))) {
      res.status(403).json({ error: "Not assigned to this department." }); return;
    }
  }
  const history = await db.select().from(statusHistoryTable)
    .where(eq(statusHistoryTable.applicationId, application.id)).orderBy(desc(statusHistoryTable.createdAt));
  const documentAudit = await db.select().from(applicationDocumentAuditTable)
    .where(eq(applicationDocumentAuditTable.applicationId, application.id));
  const events = [
    ...history,
    ...documentAudit.map(event => ({
      id: `document-${event.id}`,
      applicationId: event.applicationId,
      status: `Document ${event.action.replace(/-/g, " ")}${event.documentId ? ` · ${event.documentId}` : ""}`,
      actor: event.actorDepartment ? `${event.actorId} · ${event.actorDepartment}` : event.actorId,
      synthetic: false,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  res.json(ListApplicationHistoryResponse.parse(events));
});

export default router;
