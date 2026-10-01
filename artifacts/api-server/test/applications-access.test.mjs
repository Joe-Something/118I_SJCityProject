import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import esbuild from "esbuild";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, applicationsTable, statusHistoryTable, initializePermitApplicationSchema,
  resetPermitApplicationSchemaReadiness,
} from "@workspace/db";
import { initializeAndSeedApplications } from "../src/lib/databaseResilience.ts";
import { apiErrorHandler } from "../src/middlewares/apiErrorHandler.ts";
import { isDatabaseUnavailable } from "../src/lib/databaseResilience.ts";

if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_URL) {
  throw new Error("This suite requires NODE_ENV=test and a development test DATABASE_URL.");
}

const fixture = randomUUID();
const ownerA = `privacy-owner-a-${fixture}`;
const ownerB = `privacy-owner-b-${fixture}`;
const applicantKeyA = `case-a-${fixture}`;
const applicantKeyB = `case-b-${fixture}`;
const draftId = `PRIVACY-DRAFT-${fixture}`;
const buildingId = `PRIVACY-BUILDING-${fixture}`;
const fireId = `PRIVACY-FIRE-${fixture}`;
const reviewId = `REVIEW-PERSISTENCE-${fixture}`;
const ids = [draftId, buildingId, fireId, reviewId];
const privateValues = {
  owner: `PRIVATE_OWNER_${fixture}`,
  applicant: `PRIVATE_APPLICANT_${fixture}`,
  notes: `PRIVATE_NOTES_${fixture}`,
  plan: `PRIVATE_PLAN_${fixture}`,
};
const permittedApplicationFields = [
  "id", "businessName", "businessCategory", "requestType", "status",
  "assignedDepartment", "applicantLanguage", "submittedAt", "sourceUrl",
  "sourceDataset", "sourceDate", "sourceImportedAt", "description", "notes",
  "synthetic", "plan", "externalDeliveryStatus", "createdAt", "updatedAt",
].sort();
const createdApplicationIds = [];
let outputDir;
let server;
let baseUrl;
let lastRouteError;

function makePlan(id, ownerId, applicantKey, status, department) {
  return {
    id,
    userId: `${ownerId}:${applicantKey}`,
    intake: {
      address: `${privateValues.applicant} address`,
      businessName: `Permit case ${id}`,
      description: `${privateValues.plan} project`,
      businessType: "retail",
      modifications: [],
      applicantName: privateValues.applicant,
    },
    status,
    language: "en",
    matched: ["building-permits"],
    departments: [department],
    notes: { [department.toLowerCase()]: privateValues.notes },
    reviewerOnlyPlanField: privateValues.plan,
  };
}

async function request(method, route, actor = "anonymous", body) {
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers: {
      "x-test-actor": actor,
      ...(method === "PUT" || (method === "POST" && route === "/staff/access") ? { origin: baseUrl } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsedBody = text;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    // Preserve Express error responses as text for failure assertions.
  }
  return {
    status: response.status,
    body: parsedBody,
    retryAfter: response.headers.get("retry-after"),
    dataSource: response.headers.get("x-application-data-source"),
  };
}

function saveApplication(id, ownerId, applicantKey, status, department, submittedAt) {
  return {
    id,
    ownerId,
    applicantKey,
    businessName: `Permit case ${id}`,
    businessCategory: "retail",
    requestType: "Building Permit",
    status,
    assignedDepartment: department,
    applicantLanguage: "English",
    submittedAt,
    description: `${privateValues.plan} project`,
    notes: privateValues.notes,
    synthetic: true,
    plan: makePlan(id, ownerId, applicantKey, status, department),
  };
}

before(async () => {
  resetPermitApplicationSchemaReadiness();
  const originalConnect = pool.connect;
  let rejectInitialConnection = true;
  pool.connect = function (...args) {
    if (rejectInitialConnection) {
      rejectInitialConnection = false;
      const error = new Error("injected first initialization connection failure");
      error.code = "ECONNRESET";
      return Promise.reject(error);
    }
    return originalConnect.apply(this, args);
  };
  try {
    await assert.rejects(initializePermitApplicationSchema(), /injected first initialization connection failure/);
    await initializePermitApplicationSchema();
  } finally {
    pool.connect = originalConnect;
  }

  await initializeAndSeedApplications();
  await initializeAndSeedApplications();
  const seeded = await db.select().from(applicationsTable).where(inArray(applicationsTable.id, [
    "DEMO-D2-0001", "DEMO-D2-0024",
  ]));
  assert.deepEqual(new Set(seeded.map(row => row.id)), new Set(["DEMO-D2-0001", "DEMO-D2-0024"]));

  outputDir = await mkdtemp(new URL("./.applications-route-", import.meta.url).pathname);
  const outfile = path.join(outputDir, "applications.mjs");
  await esbuild.build({
    entryPoints: [new URL("../src/routes/applications.ts", import.meta.url).pathname],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [{
      name: "test-clerk-boundary",
      setup(build) {
        build.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "clerk", namespace: "test" }));
        build.onLoad({ filter: /^clerk$/, namespace: "test" }, () => ({
          contents: `
            const testStaff = {
              building: { staffRole: "reviewer", staffDepartment: "Building", staffAdministratorEnabled: false },
              fire: { staffRole: "reviewer", staffDepartment: "Fire" },
              economic: { staffRole: "reviewer", staffDepartment: "Economic Development", staffAdministratorEnabled: false },
              unassigned: { staffRole: "reviewer" },
              resident: {},
              visitor: {},
              existingDepartment: { staffDepartment: "Fire", existingMetadata: "preserved" },
              enrollmentFailure: { staffDepartment: "Planning", existingMetadata: "preserved" },
              metadataFailure: { staffRole: "reviewer", staffDepartment: "Building", staffAdministratorEnabled: false },
              lookupFailure: { staffRole: "reviewer", staffDepartment: "Building", staffAdministratorEnabled: false },
            };
            export const getAuth = req => ({ userId: req.headers["x-test-actor"] === "anonymous" ? null : req.headers["x-test-actor"] });
            export const clerkClient = { users: {
              getUser: async id => {
                if (id === "lookupFailure") throw new Error("Injected Clerk lookup failure");
                return { privateMetadata: testStaff[id] ?? {} };
              },
              updateUserMetadata: async (id, update) => {
                if (id === "metadataFailure" || id === "enrollmentFailure") throw new Error("Injected Clerk metadata service failure");
                testStaff[id] = { ...testStaff[id], ...update.privateMetadata };
                return { privateMetadata: testStaff[id] };
              },
            } };
          `,
          loader: "js",
        }));
      },
    }],
  });

  const { default: router } = await import(pathToFileURL(outfile).href);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = {
      error: fields => { lastRouteError = fields.err; },
      warn: () => undefined,
      info: () => undefined,
    };
    next();
  });
  app.use("/api", router);
  app.use(apiErrorHandler);
  server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const submittedAt = new Date("2026-09-20T12:00:00.000Z");
  await db.insert(applicationsTable).values([
    saveApplication(draftId, ownerA, applicantKeyA, "Draft", "Building", null),
    saveApplication(buildingId, ownerA, applicantKeyA, "Draft — Requires Review", "Building", submittedAt),
    saveApplication(fireId, ownerB, applicantKeyB, "Draft — Requires Review", "Fire", submittedAt),
    saveApplication(reviewId, ownerB, applicantKeyB, "Draft — Requires Review", "Building", submittedAt),
  ]);
  for (const applicationId of [buildingId, reviewId]) {
    const [legacyRow] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, applicationId));
    await db.update(applicationsTable).set({
      plan: {
        ...legacyRow.plan,
        intake: {
          ...legacyRow.plan.intake,
          applicantEmail: "  legacy.applicant@example.com  ",
          applicantPhone: "408-555-0199 ext 22",
          notificationConsent: true,
        },
      },
    }).where(eq(applicationsTable.id, applicationId));
  }
  await db.insert(statusHistoryTable).values(ids.map((applicationId, index) => ({
    id: `PRIVACY-HISTORY-${fixture}-${index}`,
    applicationId,
    status: index === 0 ? "Draft" : "Draft — Requires Review",
    actor: "Applicant",
    synthetic: true,
  })));
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await db.delete(statusHistoryTable).where(inArray(statusHistoryTable.applicationId, ids));
  if (createdApplicationIds.length) {
    await db.delete(statusHistoryTable).where(inArray(statusHistoryTable.applicationId, createdApplicationIds));
    await db.delete(applicationsTable).where(inArray(applicationsTable.id, createdApplicationIds));
  }
  await db.delete(applicationsTable).where(inArray(applicationsTable.id, ids));
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
  await pool.end();
});

test("applicant list returns only rows owned by that user and applicant key", async () => {
  const ownerResponse = await request("GET", `/applications/mine?applicantKey=${applicantKeyA}`, ownerA);
  assert.equal(ownerResponse.status, 200);
  assert.deepEqual(new Set(ownerResponse.body.map(row => row.id)), new Set([draftId, buildingId]));
  assert.ok(ownerResponse.body.every(row => row.externalDeliveryStatus === "not_configured"));
  assert.equal(ownerResponse.body[0].plan.userId, `${ownerA}:${applicantKeyA}`);
  assert.doesNotMatch(JSON.stringify(ownerResponse.body), /ownerId|applicantKey/);

  const otherApplicant = await request("GET", `/applications/mine?applicantKey=${applicantKeyA}`, ownerB);
  assert.equal(otherApplicant.status, 200);
  assert.deepEqual(otherApplicant.body, []);
  assert.doesNotMatch(JSON.stringify(otherApplicant.body), new RegExp(privateValues.notes));

  const differentApplicantKey = await request("GET", `/applications/mine?applicantKey=${applicantKeyB}`, ownerA);
  assert.equal(differentApplicantKey.status, 200);
  assert.deepEqual(differentApplicantKey.body, []);

  const legacyOwnerRecords = await request("GET", `/applications/mine?applicantKey=${applicantKeyB}`, ownerB);
  assert.equal(legacyOwnerRecords.status, 200);
  const legacyOwnerRecord = legacyOwnerRecords.body.find(row => row.id === reviewId);
  assert.ok(legacyOwnerRecord);
  assert.equal(legacyOwnerRecord.plan.intake.applicantEmail, "  legacy.applicant@example.com  ");
  assert.equal(legacyOwnerRecord.plan.intake.applicantPhone, "408-555-0199 ext 22");
  assert.equal(legacyOwnerRecord.externalDeliveryStatus, "not_configured");
});

test("history detail is limited to the owner and an authorized staff reviewer", async () => {
  const ownerDetail = await request("GET", `/applications/${buildingId}/history`, ownerA);
  assert.equal(ownerDetail.status, 200);
  assert.equal(ownerDetail.body.length, 1);
  assert.equal(ownerDetail.body[0].applicationId, buildingId);
  assert.deepEqual(Object.keys(ownerDetail.body[0]).sort(), [
    "id", "applicationId", "status", "actor", "synthetic", "createdAt", "updatedAt",
  ].sort());

  const otherApplicant = await request("GET", `/applications/${buildingId}/history`, ownerB);
  assert.equal(otherApplicant.status, 403);
  assert.doesNotMatch(JSON.stringify(otherApplicant.body), new RegExp(privateValues.owner));

  const assignedReviewer = await request("GET", `/applications/${buildingId}/history`, "building");
  assert.equal(assignedReviewer.status, 200);
  const crossDepartmentReviewer = await request("GET", `/applications/${buildingId}/history`, "fire");
  assert.equal(crossDepartmentReviewer.status, 200);
});

test("staff reviewers can access every department without exposing applicant identity", async () => {
  const buildingReviewer = await request("GET", `/applications/staff?applicationId=${buildingId}`, "building");
  assert.equal(buildingReviewer.status, 200);
  assert.equal(buildingReviewer.body.length, 1);
  const buildingRecord = buildingReviewer.body[0];
  assert.equal(buildingRecord.id, buildingId);
  assert.deepEqual(Object.keys(buildingRecord).sort(), permittedApplicationFields);
  assert.equal(buildingRecord.externalDeliveryStatus, "not_configured");
  const legacyStaffRecords = await request("GET", `/applications/staff?applicationId=${reviewId}`, "building");
  assert.equal(legacyStaffRecords.status, 200);
  assert.equal(legacyStaffRecords.body[0].plan.intake.applicantEmail, "  legacy.applicant@example.com  ");
  assert.equal(legacyStaffRecords.body[0].plan.intake.applicantPhone, "408-555-0199 ext 22");
  assert.equal(buildingRecord.notes, privateValues.notes);
  assert.equal(buildingRecord.plan.notes.building, privateValues.notes);
  assert.equal("ownerId" in buildingRecord, false);
  assert.equal("applicantKey" in buildingRecord, false);
  assert.equal("userId" in buildingRecord.plan, false);
  assert.doesNotMatch(JSON.stringify(buildingRecord), new RegExp(`${ownerA}:${applicantKeyA}`));

  const wrongDepartment = await request("GET", `/applications/staff?applicationId=${buildingId}`, "fire");
  assert.equal(wrongDepartment.status, 200);
  assert.deepEqual(wrongDepartment.body.map(row => row.id), [buildingId]);

  const fireRecord = await request("GET", `/applications/staff?applicationId=${fireId}`, "fire");
  assert.equal(fireRecord.status, 200);
  assert.deepEqual(fireRecord.body.map(row => row.id), [fireId]);

  const citywideReviewer = await request("GET", `/applications/staff?applicationId=${buildingId}`, "economic");
  assert.equal(citywideReviewer.status, 200);
  assert.deepEqual(citywideReviewer.body.map(row => row.id), [buildingId]);

  for (const actor of ["resident", "unassigned"]) {
    const denied = await request("GET", `/applications/staff?applicationId=${buildingId}`, actor);
    assert.equal(denied.status, 403);
    assert.doesNotMatch(JSON.stringify(denied.body), new RegExp(privateValues.plan));
  }
});

test("reviewers automatically receive server administrator access across departments", async () => {
  const initial = await request("GET", "/staff/access", "building");
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body, {
    administratorEnabled: true,
    assignedDepartment: "Building",
    accessibleDepartments: ["Planning", "Building", "Fire", "Economic Development"],
  });

  const unauthorizedActors = [
    ["anonymous", 401],
    ["resident", 403],
    ["unassigned", 403],
  ];
  for (const [actor, expectedStatus] of unauthorizedActors) {
    const denied = await request("GET", "/staff/access", actor);
    assert.equal(denied.status, expectedStatus);
  }
  const unavailableProfile = await request("GET", "/staff/access", "lookupFailure");
  assert.equal(unavailableProfile.status, 503);
  const removedToggle = await request("PUT", "/staff/access", "building", { administratorEnabled: false });
  assert.equal(removedToggle.status, 404);

  const legacyDisabledMetadata = await request("GET", "/staff/access", "building");
  const legacyUnsetMetadata = await request("GET", "/staff/access", "fire");
  for (const profile of [legacyDisabledMetadata, legacyUnsetMetadata]) {
    assert.equal(profile.status, 200);
    assert.equal(profile.body.administratorEnabled, true);
    assert.deepEqual(profile.body.accessibleDepartments, [
      "Planning", "Building", "Fire", "Economic Development",
    ]);
  }

  const crossDepartmentList = await request("GET", `/applications/staff?applicationId=${fireId}`, "building");
  assert.equal(crossDepartmentList.status, 200);
  assert.deepEqual(crossDepartmentList.body.map(row => row.id), [fireId]);
  assert.equal(crossDepartmentList.body[0].ownerId, undefined);
  assert.equal(crossDepartmentList.body[0].applicantKey, undefined);

  const originalQuery = pool.query;
  let outageFailures = 0;
  pool.query = function (query, ...args) {
    const text = typeof query === "string" ? query : query?.text;
    if (/select[\s\S]*from\s+"?permit_applications"?/i.test(text ?? "") && outageFailures < 2) {
      outageFailures += 1;
      const error = new Error("temporary database connection interruption");
      error.code = "ECONNRESET";
      return Promise.reject(error);
    }
    return originalQuery.call(this, query, ...args);
  };
  try {
    const fallback = await request("GET", "/applications?applicationId=DEMO-D2-0002", "building");
    assert.equal(fallback.status, 200);
    assert.equal(fallback.body.length, 1);
    assert.equal(fallback.body[0].plan._dataSource, "sample-fallback");
    const rejectedSampleWrite = await request("POST", `/applications/${fallback.body[0].id}/response`, "building", {
      text: "A sample must remain read-only even for administrators.",
    });
    assert.equal(rejectedSampleWrite.status, 409);
  } finally {
    pool.query = originalQuery;
  }

  const crossDepartmentHistory = await request("GET", `/applications/${fireId}/history`, "building");
  assert.equal(crossDepartmentHistory.status, 200);
  const crossDepartmentDocuments = await request("GET", `/applications/${fireId}/documents`, "building");
  assert.equal(crossDepartmentDocuments.status, 200);
  assert.deepEqual(crossDepartmentDocuments.body, []);

  const fireRecord = crossDepartmentList.body[0];
  const reviewed = await request("PATCH", `/applications/${fireId}/review`, "building", {
    plan: { ...fireRecord.plan, status: "Approved" },
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.status, "Approved");
  const crossDepartmentResponse = await request("POST", `/applications/${fireId}/response`, "building", {
    text: "Please provide a corrected site drawing for review.",
  });
  assert.equal(crossDepartmentResponse.status, 200, JSON.stringify({
    stack: lastRouteError?.stack,
    cause: lastRouteError?.cause,
    causeMessage: lastRouteError?.cause?.message,
  }));
  assert.equal(crossDepartmentResponse.body.externalDeliveryStatus, "not_configured");
  assert.equal(
    crossDepartmentResponse.body.plan.notes._staff_response,
    "Please provide a corrected site drawing for review.",
  );

  // Administrator privileges do not alter applicant ownership checks.
  const otherApplicantsRecords = await request("GET", `/applications/mine?applicantKey=${applicantKeyB}`, "building");
  assert.deepEqual(otherApplicantsRecords.body, []);

  assert.equal(crossDepartmentList.body[0].assignedDepartment, "Fire");
  const continuesCrossDepartmentAccess = await request("GET", `/applications/staff?applicationId=${fireId}`, "building");
  assert.deepEqual(continuesCrossDepartmentAccess.body.map(row => row.id), [fireId]);
});

test("selecting City Staff enrolls only the authenticated account and grants full access", async () => {
  const unselectedAccount = await request("GET", "/staff/access", "visitor");
  assert.equal(unselectedAccount.status, 403);
  const unselectedQueue = await request("GET", `/applications/staff?applicationId=${fireId}`, "visitor");
  assert.equal(unselectedQueue.status, 403);

  const blockedEnrollments = [
    { name: "missing Origin", headers: {} },
    { name: "another site", headers: { origin: "https://attacker.invalid" } },
    { name: "wrong protocol", headers: { origin: baseUrl.replace("http://", "https://") } },
    { name: "Bearer authorization without Origin", headers: { authorization: "Bearer verified-test-token" } },
  ];
  for (const { name, headers } of blockedEnrollments) {
    const response = await fetch(`${baseUrl}/api/staff/access`, {
      method: "POST",
      headers: { "x-test-actor": "visitor", ...headers },
    });
    assert.equal(response.status, 403, `${name} cannot enroll`);
    assert.equal((await request("GET", "/staff/access", "visitor")).status, 403);
  }

  const bearerMutation = await fetch(`${baseUrl}/api/staff/access`, {
    method: "POST",
    headers: {
      "x-test-actor": "visitor",
      authorization: "Bearer verified-test-token",
      origin: baseUrl,
      "content-type": "application/json",
    },
    body: JSON.stringify({ userId: "resident", department: "Planning" }),
  });
  assert.equal(bearerMutation.status, 400, "the browser cannot select another user's identity or department");
  assert.equal((await request("GET", "/staff/access", "visitor")).status, 403);
  const clerkFailure = await request("POST", "/staff/access", "enrollmentFailure");
  assert.equal(clerkFailure.status, 503);
  assert.equal((await request("GET", "/staff/access", "enrollmentFailure")).status, 403);
  const lookupFailure = await request("POST", "/staff/access", "lookupFailure");
  assert.equal(lookupFailure.status, 503);

  const enteredStaffWorkspace = await request("POST", "/staff/access", "visitor");
  assert.equal(enteredStaffWorkspace.status, 200);
  assert.equal(enteredStaffWorkspace.body.administratorEnabled, true);
  assert.equal(enteredStaffWorkspace.body.assignedDepartment, "Economic Development");
  assert.deepEqual(enteredStaffWorkspace.body.accessibleDepartments, [
    "Planning", "Building", "Fire", "Economic Development",
  ]);
  const responseWithNoStore = await fetch(`${baseUrl}/api/staff/access`, {
    headers: { "x-test-actor": "visitor" },
  });
  assert.equal(responseWithNoStore.status, 200);
  assert.equal(responseWithNoStore.headers.get("cache-control"), "no-store");
  assert.deepEqual(await responseWithNoStore.json(), enteredStaffWorkspace.body);

  const repeatEnrollment = await request("POST", "/staff/access", "visitor");
  assert.equal(repeatEnrollment.status, 200);
  assert.deepEqual(repeatEnrollment.body, enteredStaffWorkspace.body);

  const existingAssignment = await request("POST", "/staff/access", "existingDepartment");
  assert.equal(existingAssignment.status, 200);
  assert.equal(existingAssignment.body.assignedDepartment, "Fire");
  assert.deepEqual(existingAssignment.body.accessibleDepartments, [
    "Planning", "Building", "Fire", "Economic Development",
  ]);

  const crossDepartmentList = await request("GET", `/applications/staff?applicationId=${fireId}`, "visitor");
  assert.equal(crossDepartmentList.status, 200);
  assert.deepEqual(crossDepartmentList.body.map(row => row.id), [fireId]);
  assert.equal(crossDepartmentList.body[0].ownerId, undefined);
  assert.equal(crossDepartmentList.body[0].applicantKey, undefined);
  assert.equal((await request("GET", `/applications/${fireId}/history`, "visitor")).status, 200);
  assert.deepEqual((await request("GET", `/applications/${fireId}/documents`, "visitor")).body, []);

  // Selecting the staff workspace does not change applicant ownership checks.
  const ownApplicantPlans = await request("GET", `/applications/mine?applicantKey=${applicantKeyA}`, "visitor");
  assert.equal(ownApplicantPlans.status, 200);
  assert.deepEqual(ownApplicantPlans.body, []);
});

test("reviewer notes, overrides, and rejections persist through completion and reopening", async () => {
  const reviewerNote = "Confirm the accessible entrance clearance.";
  const override = "Use the updated neighborhood business registration checklist.";
  const rejectedItem = "zoning-clearance";

  const savedDecision = await request("PATCH", `/applications/${reviewId}/review`, "building", {
    plan: {
      status: "Draft — Requires Review",
      intake: {
        applicantEmail: "  legacy.applicant@example.com  ",
        applicantPhone: "408-555-0199 ext 22",
        notificationConsent: true,
      },
      notes: { "building-permits": reviewerNote },
      overrides: { "business-registration": override },
      rejected: [rejectedItem],
    },
  });
  assert.equal(savedDecision.status, 200);
  assert.equal(savedDecision.body.plan.intake.applicantEmail, "  legacy.applicant@example.com  ");
  assert.equal(savedDecision.body.plan.intake.applicantPhone, "408-555-0199 ext 22");
  assert.equal(savedDecision.body.plan.notes["building-permits"], reviewerNote);
  assert.equal(savedDecision.body.plan.overrides["business-registration"], override);
  assert.deepEqual(savedDecision.body.plan.rejected, [rejectedItem]);

  const legacyStaffResponse = await request("POST", `/applications/${reviewId}/response`, "building", {
    text: "A legacy contact value remains untouched while staff respond.",
  });
  assert.equal(legacyStaffResponse.status, 200);
  assert.equal(legacyStaffResponse.body.externalDeliveryStatus, "not_configured");
  assert.equal(legacyStaffResponse.body.plan.intake.applicantEmail, "  legacy.applicant@example.com  ");
  assert.equal(legacyStaffResponse.body.plan.intake.applicantPhone, "408-555-0199 ext 22");

  const completed = await request("PATCH", `/applications/${reviewId}/review`, "building", {
    plan: { status: "Rejected" },
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, "Rejected");
  assert.equal(typeof completed.body.plan.completedAt, "number");

  const reopened = await request("PATCH", `/applications/${reviewId}/review`, "building", {
    plan: { status: "In Review (Re-opened)" },
  });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.status, "In Review (Re-opened)");
  assert.equal(reopened.body.plan.completedAt, null);

  const reloaded = await request("GET", `/applications/staff?applicationId=${reviewId}`, "building");
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.body.length, 1);
  assert.equal(reloaded.body[0].status, "In Review (Re-opened)");
  assert.equal(reloaded.body[0].plan.notes["building-permits"], reviewerNote);
  assert.equal(reloaded.body[0].plan.overrides["business-registration"], override);
  assert.deepEqual(reloaded.body[0].plan.rejected, [rejectedItem]);

  const [stored] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, reviewId));
  assert.equal(stored.status, "In Review (Re-opened)");
  assert.equal(stored.plan.notes["building-permits"], reviewerNote);
  assert.equal(stored.plan.overrides["business-registration"], override);
  assert.deepEqual(stored.plan.rejected, [rejectedItem]);
});

test("staff queue falls back only for transient database failures and recovers on the next request", async () => {
  const originalQuery = pool.query;
  let transientFailures = 0;
  pool.query = function (query, ...args) {
    const text = typeof query === "string" ? query : query?.text;
    if (/select[\s\S]*from\s+"?permit_applications"?/i.test(text ?? "") && transientFailures < 2) {
      transientFailures += 1;
      const error = new Error("temporary database connection interruption");
      error.code = "ECONNRESET";
      return Promise.reject(error);
    }
    return originalQuery.call(this, query, ...args);
  };
  try {
    const unavailable = await request("GET", "/applications?businessCategory=Bakery", "building");
    assert.equal(transientFailures, 2, "the query is retried once before the sample fallback");
    assert.equal(unavailable.status, 200);
    assert.ok(unavailable.body.length > 0, "authorized staff can query sample fallback in every department");
    assert.ok(unavailable.body.every(row => row.plan._dataSource === "sample-fallback"));
    assert.match(unavailable.body[0].id, /^DEMO-D2-/);
    assert.equal(unavailable.body[0].plan._dataSource, "sample-fallback");
    assert.equal(unavailable.body[0].plan.intake.applicantEmail, "sample-applicant-2@example.invalid");
    assert.equal(unavailable.body[0].assignedDepartment, "Building");
    const fakeWrite = await request("POST", `/applications/${unavailable.body[0].id}/response`, "building", {
      text: "Must never be acknowledged as a saved response",
    });
    assert.equal(fakeWrite.status, 409);

    const signedOut = await request("GET", "/applications", "anonymous");
    assert.equal(signedOut.status, 401);
    assert.deepEqual(signedOut.body, { error: "Sign in to continue." });
    const unassigned = await request("GET", "/applications", "unassigned");
    assert.equal(unassigned.status, 403);
    assert.doesNotMatch(JSON.stringify(unassigned.body), /DEMO-D2-/);
  } finally {
    pool.query = originalQuery;
  }

  const recovered = await request("GET", `/applications?applicationId=${buildingId}`, "building");
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.body.map(row => row.id), [buildingId]);
  assert.equal(recovered.body[0].plan._dataSource, undefined);
});

test("known PostgreSQL and pg-pool timeout shapes are classified as database outages", () => {
  const timeouts = [
    Object.assign(new Error("timeout exceeded when trying to connect"), {}),
    Object.assign(new Error("Connection terminated due to connection timeout"), {}),
    Object.assign(new Error("Query read timeout"), {}),
    Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }),
    new Error("request failed", {
      cause: Object.assign(new Error("Query read timeout"), {}),
    }),
  ];
  for (const error of timeouts) assert.equal(isDatabaseUnavailable(error), true, error.message);

  assert.equal(isDatabaseUnavailable(Object.assign(
    new Error("canceling statement due to user request"),
    { code: "57014" },
  )), false);
  assert.equal(isDatabaseUnavailable(new TypeError("Cannot read properties of undefined")), false);
  assert.equal(isDatabaseUnavailable(new Error("a plugin timed out while serializing the response")), false);
});

test("unexpected staff list programming errors and unrelated cancellation return 500", async () => {
  const originalQuery = pool.query;
  const failures = [
    new TypeError("injected programming failure"),
    Object.assign(new Error("canceling statement due to user request"), { code: "57014" }),
  ];
  try {
    for (const failure of failures) {
      pool.query = function (query, ...args) {
        const text = typeof query === "string" ? query : query?.text;
        if (/select[\s\S]*from\s+"?permit_applications"?/i.test(text ?? "")) {
          return Promise.reject(failure);
        }
        return originalQuery.call(this, query, ...args);
      };
      const response = await request("GET", "/applications", "building");
      assert.equal(response.status, 500);
      assert.deepEqual(response.body, { error: "Could not load applications." });
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("applicant list exposes a retryable 503 during a database outage without sample data", async () => {
  const originalQuery = pool.query;
  let failures = 0;
  pool.query = function (query, ...args) {
    const text = typeof query === "string" ? query : query?.text;
    if (/select[\s\S]*from\s+"?permit_applications"?/i.test(text ?? "") && failures < 2) {
      failures += 1;
      const error = new Error("temporary database connection interruption");
      error.code = "ECONNRESET";
      return Promise.reject(error);
    }
    return originalQuery.call(this, query, ...args);
  };
  try {
    const response = await request("GET", `/applications/mine?applicantKey=${applicantKeyA}`, ownerA);
    assert.equal(response.status, 503);
    assert.equal(response.retryAfter, "30");
    assert.doesNotMatch(JSON.stringify(response.body), /DEMO-D2-/);
  } finally {
    pool.query = originalQuery;
  }
});

test("staff list returns 503 when database fallback has no records matching filters", async () => {
  const originalQuery = pool.query;
  let failures = 0;
  pool.query = function (query, ...args) {
    const text = typeof query === "string" ? query : query?.text;
    if (/select[\s\S]*from\s+"?permit_applications"?/i.test(text ?? "") && failures < 2) {
      failures += 1;
      const error = new Error("temporary database connection interruption");
      error.code = "ECONNRESET";
      return Promise.reject(error);
    }
    return originalQuery.call(this, query, ...args);
  };
  try {
    const response = await request("GET", "/applications?businessCategory=NoSuchExampleCategory", "building");
    assert.equal(response.status, 503);
    assert.equal(response.retryAfter, "30");
    assert.equal(response.dataSource, null);
  } finally {
    pool.query = originalQuery;
  }
});

test("only the owning applicant can update a draft or its private plan", async () => {
  const before = (await db.select().from(applicationsTable).where(eq(applicationsTable.id, draftId)))[0];
  const attemptedPlan = {
    ...before.plan,
    reviewerOnlyPlanField: "ATTACKER_CHANGED_PLAN",
    notes: { building: "ATTACKER_CHANGED_NOTES" },
  };
  const attack = {
    ownerId: ownerB,
    applicantKey: applicantKeyA,
    plan: attemptedPlan,
  };

  for (const actor of [ownerB, "building"]) {
    const denied = await request("PATCH", `/applications/${draftId}`, actor, attack);
    assert.equal(denied.status, 404);
  }

  const unchanged = (await db.select().from(applicationsTable).where(eq(applicationsTable.id, draftId)))[0];
  assert.equal(unchanged.ownerId, ownerA);
  assert.equal(unchanged.applicantKey, applicantKeyA);
  assert.deepEqual(unchanged.plan, before.plan);
  assert.equal(unchanged.notes, before.notes);

  const ownerUpdate = await request("PATCH", `/applications/${draftId}`, ownerA, {
    ownerId: ownerB,
    applicantKey: applicantKeyA,
    plan: {
      ...before.plan,
      reviewerOnlyPlanField: "OWNER_UPDATED_PLAN",
      status: "Draft",
    },
  });
  assert.equal(ownerUpdate.status, 200);
  assert.equal(ownerUpdate.body.plan.reviewerOnlyPlanField, "OWNER_UPDATED_PLAN");
  assert.equal(ownerUpdate.body.plan.userId, `${ownerA}:${applicantKeyA}`);
  const persisted = (await db.select().from(applicationsTable).where(eq(applicationsTable.id, draftId)))[0];
  assert.equal(persisted.ownerId, ownerA);
  assert.equal(persisted.applicantKey, applicantKeyA);
});

test("created intake contacts are trimmed and notification consent defaults to false", async () => {
  const created = await request("POST", "/applications", ownerA, {
    applicantKey: applicantKeyA,
    externalDeliveryStatus: "delivered",
    plan: {
      status: "Draft",
      language: "en",
      matched: ["building-permits"],
      departments: ["Building"],
      intake: {
        address: "101 Test Avenue",
        businessName: "Contact Test Shop",
        description: "A new retail space",
        businessType: "retail",
        modifications: [],
        applicantName: "  Intake Applicant  ",
        applicantEmail: "   ",
        retainedIntakeField: "keep this",
      },
      retainedPlanField: "keep this too",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.externalDeliveryStatus, "not_configured");
  assert.equal(created.body.plan.intake.applicantName, "Intake Applicant");
  assert.equal(created.body.plan.intake.applicantEmail, "");
  assert.equal(created.body.plan.intake.notificationConsent, false);
  assert.equal(created.body.plan.intake.retainedIntakeField, "keep this");
  assert.equal(created.body.plan.retainedPlanField, "keep this too");
  assert.equal(created.body.externalDeliveryStatus, "not_configured", "client-supplied delivery status is ignored");
  createdApplicationIds.push(created.body.id);
  const [stored] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, created.body.id));
  assert.equal(stored.plan.intake.notificationConsent, false);
  assert.equal(stored.plan.intake.applicantName, "Intake Applicant");

  const invalidConsent = await request("POST", "/applications", ownerA, {
    applicantKey: applicantKeyA,
    plan: {
      ...created.body.plan,
      intake: {
        ...created.body.plan.intake,
        applicantEmail: "",
        applicantPhone: "",
        notificationConsent: true,
      },
    },
  });
  assert.equal(invalidConsent.status, 400, "intake consent requires a valid contact method");
  const invalidIntakeValues = [
    { applicantName: "n".repeat(201) },
    { applicantEmail: "not-an-email" },
    { applicantPhone: "408-555" },
    { applicantPhone: "4085550199 ext" },
    { notificationConsent: "true" },
  ];
  for (const invalidIntake of invalidIntakeValues) {
    const invalid = await request("POST", "/applications", ownerA, {
      applicantKey: applicantKeyA,
      plan: {
        ...created.body.plan,
        intake: { ...created.body.plan.intake, ...invalidIntake },
      },
    });
    assert.equal(invalid.status, 400, JSON.stringify(invalidIntake));
  }
});

test("owners can update and withdraw contact consent on a completed application", async () => {
  const submittedList = await request("GET", `/applications/mine?applicantKey=${applicantKeyA}`, ownerA);
  const submittedRecord = submittedList.body.find(row => row.id === buildingId);
  assert.ok(submittedRecord);
  const submittedContact = await request("PATCH", `/applications/${buildingId}/contact`, ownerA, {
    applicantKey: applicantKeyA,
    expectedUpdatedAt: submittedRecord.updatedAt,
    applicantName: "Submitted Applicant",
    notificationConsent: false,
  });
  assert.equal(submittedContact.status, 200);
  assert.equal(submittedContact.body.status, "Draft — Requires Review");
  assert.equal(submittedContact.body.plan.intake.applicantName, "Submitted Applicant");
  assert.equal(submittedContact.body.plan.intake.applicantEmail, "  legacy.applicant@example.com  ");
  assert.equal(submittedContact.body.plan.intake.applicantPhone, "408-555-0199 ext 22");
  assert.equal(submittedContact.body.plan.intake.notificationConsent, false);

  const completed = await request("PATCH", `/applications/${buildingId}/review`, "building", {
    plan: { status: "Approved" },
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, "Approved");
  assert.equal(completed.body.externalDeliveryStatus, "not_configured");

  const beforeList = await request("GET", `/applications/mine?applicantKey=${applicantKeyA}`, ownerA);
  const current = beforeList.body.find(row => row.id === buildingId);
  assert.ok(current);
  const beforeNotes = current.notes;
  const beforePlanNotes = current.plan.notes;
  const contact = await request("PATCH", `/applications/${buildingId}/contact`, ownerA, {
    applicantKey: applicantKeyA,
    expectedUpdatedAt: current.updatedAt,
    applicantName: "  Ada Applicant  ",
    applicantEmail: "  ada@example.com ",
    applicantPhone: " +1 (408) 555-0123 ",
    notificationConsent: true,
    externalDeliveryStatus: "sent",
  });
  assert.equal(contact.status, 200, JSON.stringify(contact.body));
  assert.equal(contact.body.externalDeliveryStatus, "not_configured");
  assert.equal(contact.body.status, "Approved");
  assert.equal(contact.body.plan.intake.applicantName, "Ada Applicant");
  assert.equal(contact.body.plan.intake.applicantEmail, "ada@example.com");
  assert.equal(contact.body.plan.intake.applicantPhone, "+1 (408) 555-0123");
  assert.equal(contact.body.plan.intake.notificationConsent, true);
  assert.equal(contact.body.notes, beforeNotes);
  assert.deepEqual(contact.body.plan.notes, beforePlanNotes);

  // Staff review bodies cannot overwrite contact details or permission.
  const staffReview = await request("PATCH", `/applications/${buildingId}/review`, "building", {
    plan: {
      status: "In Review (Re-opened)",
      intake: {
        applicantName: "Reviewer overwrite",
        applicantEmail: "reviewer@example.com",
        applicantPhone: "4085550199",
        notificationConsent: false,
      },
    },
  });
  assert.equal(staffReview.status, 200);
  assert.equal(staffReview.body.externalDeliveryStatus, "not_configured");
  assert.equal(staffReview.body.plan.intake.applicantName, "Ada Applicant");
  assert.equal(staffReview.body.plan.intake.applicantEmail, "ada@example.com");
  assert.equal(staffReview.body.plan.intake.applicantPhone, "+1 (408) 555-0123");
  assert.equal(staffReview.body.plan.intake.notificationConsent, true);

  // A user outside the owner account, including an unassigned staff account, cannot change this record.
  for (const actor of [ownerB, "building", "unassigned"]) {
    const denied = await request("PATCH", `/applications/${buildingId}/contact`, actor, {
      applicantKey: applicantKeyA,
      applicantName: "Unauthorized",
      notificationConsent: false,
    });
    assert.equal(denied.status, 404);
  }

  const stale = await request("PATCH", `/applications/${buildingId}/contact`, ownerA, {
    applicantKey: applicantKeyA,
    expectedUpdatedAt: new Date(Date.parse(contact.body.updatedAt) - 60_000).toISOString(),
    notificationConsent: false,
  });
  assert.equal(stale.status, 409, "stale optimistic-concurrency versions are rejected");

  const withdrawal = await request("PATCH", `/applications/${buildingId}/contact`, ownerA, {
    applicantKey: applicantKeyA,
    expectedUpdatedAt: staffReview.body.updatedAt,
    notificationConsent: false,
  });
  assert.equal(withdrawal.status, 200);
  assert.equal(withdrawal.body.status, "In Review (Re-opened)");
  assert.equal(withdrawal.body.plan.intake.applicantName, "Ada Applicant");
  assert.equal(withdrawal.body.plan.intake.applicantEmail, "ada@example.com");
  assert.equal(withdrawal.body.plan.intake.applicantPhone, "+1 (408) 555-0123");
  assert.equal(withdrawal.body.plan.intake.notificationConsent, false);
  assert.equal(withdrawal.body.externalDeliveryStatus, "not_configured");
  const [persistedWithdrawal] = await db.select().from(applicationsTable)
    .where(eq(applicationsTable.id, buildingId));
  assert.equal(persistedWithdrawal.plan.intake.notificationConsent, false);
  assert.equal(persistedWithdrawal.plan.intake.applicantEmail, "ada@example.com");
  assert.equal(persistedWithdrawal.status, "In Review (Re-opened)");

  const invalidRequests = [
    { applicantEmail: "not-an-email", notificationConsent: false },
    { applicantPhone: "123-456", notificationConsent: false },
    { applicantPhone: "4085550199 ext", notificationConsent: false },
    { applicantPhone: "1234567890123456", notificationConsent: false },
    { applicantName: "n".repeat(201), notificationConsent: false },
    { applicantEmail: `${"x".repeat(250)}@a.co`, notificationConsent: false },
    { notificationConsent: "true" },
    { applicantEmail: "", applicantPhone: "", notificationConsent: true },
  ];
  for (const invalidContact of invalidRequests) {
    const invalid = await request("PATCH", `/applications/${buildingId}/contact`, ownerA, {
      applicantKey: applicantKeyA,
      notificationConsent: false,
      ...invalidContact,
    });
    assert.equal(invalid.status, 400, JSON.stringify(invalidContact));
  }

  const sampleWrite = await request("PATCH", "/applications/DEMO-D2-0002/contact", ownerA, {
    applicantKey: applicantKeyA,
    notificationConsent: false,
  });
  assert.equal(sampleWrite.status, 409);

  await db.update(applicationsTable).set({ sourceUrl: "https://source.example.test/record" })
    .where(eq(applicationsTable.id, draftId));
  const sourceWrite = await request("PATCH", `/applications/${draftId}/contact`, ownerA, {
    applicantKey: applicantKeyA,
    notificationConsent: false,
  });
  assert.equal(sourceWrite.status, 409);
  await db.update(applicationsTable).set({ sourceUrl: null }).where(eq(applicationsTable.id, draftId));
});