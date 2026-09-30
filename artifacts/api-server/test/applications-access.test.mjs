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
const ids = [draftId, buildingId, fireId];
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
  "synthetic", "plan", "createdAt", "updatedAt",
].sort();
let outputDir;
let server;
let baseUrl;

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
            export const getAuth = req => ({ userId: req.headers["x-test-actor"] === "anonymous" ? null : req.headers["x-test-actor"] });
            export const clerkClient = { users: { getUser: async id => ({
              privateMetadata: ({
                building: { staffRole: "reviewer", staffDepartment: "Building" },
                fire: { staffRole: "reviewer", staffDepartment: "Fire" },
                economic: { staffRole: "reviewer", staffDepartment: "Economic Development" },
                unassigned: { staffRole: "reviewer" },
                resident: {},
              })[id] ?? {}
            }) } };
          `,
          loader: "js",
        }));
      },
    }],
  });

  const { default: router } = await import(pathToFileURL(outfile).href);
  const app = express();
  app.use(express.json());
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
  ]);
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
  await db.delete(applicationsTable).where(inArray(applicationsTable.id, ids));
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
  await pool.end();
});

test("applicant list returns only rows owned by that user and applicant key", async () => {
  const ownerResponse = await request("GET", `/applications/mine?applicantKey=${applicantKeyA}`, ownerA);
  assert.equal(ownerResponse.status, 200);
  assert.deepEqual(new Set(ownerResponse.body.map(row => row.id)), new Set([draftId, buildingId]));
  assert.equal(ownerResponse.body[0].plan.userId, `${ownerA}:${applicantKeyA}`);
  assert.doesNotMatch(JSON.stringify(ownerResponse.body), /ownerId|applicantKey/);

  const otherApplicant = await request("GET", `/applications/mine?applicantKey=${applicantKeyA}`, ownerB);
  assert.equal(otherApplicant.status, 200);
  assert.deepEqual(otherApplicant.body, []);
  assert.doesNotMatch(JSON.stringify(otherApplicant.body), new RegExp(privateValues.notes));

  const differentApplicantKey = await request("GET", `/applications/mine?applicantKey=${applicantKeyB}`, ownerA);
  assert.equal(differentApplicantKey.status, 200);
  assert.deepEqual(differentApplicantKey.body, []);
});

test("history detail is limited to the owner and an authorized reviewer", async () => {
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
  const unassignedReviewer = await request("GET", `/applications/${buildingId}/history`, "fire");
  assert.equal(unassignedReviewer.status, 403);
});

test("reviewer list is department-scoped and omits applicant identity fields", async () => {
  const buildingReviewer = await request("GET", `/applications/staff?applicationId=${buildingId}`, "building");
  assert.equal(buildingReviewer.status, 200);
  assert.equal(buildingReviewer.body.length, 1);
  const buildingRecord = buildingReviewer.body[0];
  assert.equal(buildingRecord.id, buildingId);
  assert.deepEqual(Object.keys(buildingRecord).sort(), permittedApplicationFields);
  assert.equal(buildingRecord.notes, privateValues.notes);
  assert.equal(buildingRecord.plan.notes.building, privateValues.notes);
  assert.equal("ownerId" in buildingRecord, false);
  assert.equal("applicantKey" in buildingRecord, false);
  assert.equal("userId" in buildingRecord.plan, false);
  assert.doesNotMatch(JSON.stringify(buildingRecord), new RegExp(`${ownerA}:${applicantKeyA}`));

  const wrongDepartment = await request("GET", `/applications/staff?applicationId=${buildingId}`, "fire");
  assert.equal(wrongDepartment.status, 200);
  assert.deepEqual(wrongDepartment.body, []);

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
    assert.equal(unavailable.body.length, 1);
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