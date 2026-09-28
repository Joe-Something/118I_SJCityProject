import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, gte, ilike, isNotNull, lt, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, applicationsTable, type Application } from "@workspace/db";
import {
  CreateApplicationBody, CreateApplicationResponse,
  ListMyApplicationsQueryParams, ListMyApplicationsResponse,
  SearchStaffApplicationsQueryParams, SearchStaffApplicationsResponse,
  UpdateMyApplicationBody, UpdateMyApplicationParams, UpdateMyApplicationResponse,
  ReviewApplicationBody, ReviewApplicationParams, ReviewApplicationResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const statuses = new Set([
  "Draft", "Draft — Requires Review", "In Review (Re-opened)",
  "Approved", "Rejected", "Modified via Staff Override",
]);
const completed = new Set(["Approved", "Rejected", "Modified via Staff Override"]);

function currentUser(req: Request, res: Response): string | null {
  const id = getAuth(req).userId;
  if (!id) res.status(401).json({ error: "Sign in to access applications." });
  return id;
}

function parsePlan(value: Record<string, unknown>): { intake: Record<string, unknown>; status: string; language: string; matched: string[]; departments: string[] } | null {
  const intake = value.intake;
  if (!intake || typeof intake !== "object" || Array.isArray(intake)) return null;
  const details = intake as Record<string, unknown>;
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

function respond(record: Application) {
  const { ownerId: _ownerId, applicantKey: _applicantKey, ...publicRecord } = record;
  return publicRecord;
}

router.get("/applications/mine", async (req, res): Promise<void> => {
  const userId = currentUser(req, res);
  if (!userId) return;
  const query = ListMyApplicationsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "An applicant key is required." }); return; }
  const key = query.data.applicantKey.trim().toLowerCase();
  if (!key) { res.status(400).json({ error: "An applicant key is required." }); return; }
  const rows = await db.select().from(applicationsTable)
    .where(and(eq(applicationsTable.ownerId, userId), eq(applicationsTable.applicantKey, key)))
    .orderBy(desc(applicationsTable.updatedAt));
  res.json(ListMyApplicationsResponse.parse(rows.map(respond)));
});

router.get("/applications/staff", async (req, res): Promise<void> => {
  if (!currentUser(req, res)) return;
  const query = SearchStaffApplicationsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid search filters." }); return; }
  const fields: [string | undefined, AnyPgColumn][] = [
    [query.data.applicationId, applicationsTable.id],
    [query.data.businessName, applicationsTable.businessName],
    [query.data.businessCategory, applicationsTable.businessCategory],
    [query.data.requestType, applicationsTable.requestType],
    [query.data.status, applicationsTable.status],
    [query.data.assignedDepartment, applicationsTable.assignedDepartment],
    [query.data.applicantLanguage, applicationsTable.applicantLanguage],
  ];
  // Staff queue contains submitted applications only; unsent drafts stay private.
  const conditions: SQL[] = [isNotNull(applicationsTable.submittedAt)];
  for (const [term, column] of fields) {
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
  const rows = await db.select().from(applicationsTable).where(and(...conditions))
    .orderBy(desc(applicationsTable.submittedAt)).limit(500);
  res.json(SearchStaffApplicationsResponse.parse(rows.map(respond)));
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
  const plan = { ...body.data.plan, id, userId: `${userId}:${body.data.applicantKey.trim().toLowerCase()}`, intake: { ...(body.data.plan.intake as object), files: [] } };
  const [row] = await db.insert(applicationsTable).values({
    id, ownerId: userId, applicantKey: body.data.applicantKey.trim().toLowerCase(),
    ...fields, synthetic: true, plan, submittedAt: fields.status === "Draft" ? null : now,
  }).returning();
  res.status(201).json(CreateApplicationResponse.parse(respond(row)));
});

router.patch("/applications/:id", async (req, res): Promise<void> => {
  const userId = currentUser(req, res);
  if (!userId) return;
  const params = UpdateMyApplicationParams.safeParse(req.params);
  const body = UpdateMyApplicationBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid application update." }); return; }
  const key = body.data.applicantKey.trim().toLowerCase();
  const [existing] = await db.select().from(applicationsTable).where(and(
    eq(applicationsTable.id, params.data.id), eq(applicationsTable.ownerId, userId), eq(applicationsTable.applicantKey, key),
  ));
  if (!existing) { res.status(404).json({ error: "Application not found." }); return; }
  const fields = fieldsFromPlan(body.data.plan);
  if (!fields || existing.status !== "Draft" || !["Draft", "Draft — Requires Review"].includes(fields.status)) {
    res.status(400).json({ error: "This application cannot be changed in its current status." }); return;
  }
  const now = new Date();
  const plan = { ...existing.plan, ...body.data.plan, id: existing.id, userId: `${userId}:${key}`, intake: { ...(body.data.plan.intake as object), files: [] } };
  const [row] = await db.update(applicationsTable).set({
    ...fields, plan, updatedAt: now, submittedAt: existing.submittedAt ?? (fields.status === "Draft" ? null : now),
  }).where(eq(applicationsTable.id, existing.id)).returning();
  res.json(UpdateMyApplicationResponse.parse(respond(row)));
});

router.patch("/applications/:id/review", async (req, res): Promise<void> => {
  // Prototype staff personas are self-selected in the client; this is not a production authorization boundary.
  if (!currentUser(req, res)) return;
  const params = ReviewApplicationParams.safeParse(req.params);
  const body = ReviewApplicationBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid review update." }); return; }
  const [existing] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, params.data.id));
  if (!existing || !existing.submittedAt) { res.status(404).json({ error: "Submitted application not found." }); return; }
  const proposed = body.data.plan;
  const status = typeof proposed.status === "string" ? proposed.status : existing.status;
  if (!statuses.has(status) || status === "Draft" || (completed.has(existing.status) && status !== "In Review (Re-opened)")) {
    res.status(400).json({ error: "Invalid review status." }); return;
  }
  const plan = { ...existing.plan, status,
    notes: proposed.notes && typeof proposed.notes === "object" && !Array.isArray(proposed.notes) ? proposed.notes : existing.plan.notes,
    overrides: proposed.overrides && typeof proposed.overrides === "object" && !Array.isArray(proposed.overrides) ? proposed.overrides : existing.plan.overrides,
    rejected: Array.isArray(proposed.rejected) && proposed.rejected.every(item => typeof item === "string") ? proposed.rejected : existing.plan.rejected,
    completedAt: completed.has(status) ? Date.now() : null, updatedAt: Date.now(),
  };
  const fields = fieldsFromPlan(plan);
  if (!fields) { res.status(400).json({ error: "Invalid stored plan." }); return; }
  const [row] = await db.update(applicationsTable).set({ plan, status, notes: fields.notes, updatedAt: new Date() })
    .where(eq(applicationsTable.id, existing.id)).returning();
  res.json(ReviewApplicationResponse.parse(respond(row)));
});

export default router;