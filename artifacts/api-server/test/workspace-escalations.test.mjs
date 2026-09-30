import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import esbuild from "esbuild";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, pool, applicationsTable, workspaceAcknowledgementsTable, workspaceConversationsTable, workspaceMessagesTable,
} from "@workspace/db";
import {
  ListWorkspacePrototypeSourcesResponse,
  ListWorkspaceRecordsResponse,
} from "@workspace/api-zod";
import { refreshPublicPermits } from "../src/lib/public-permits.ts";
import { prototypeSources } from "../src/lib/prototype-sources.ts";
import { apiErrorHandler } from "../src/middlewares/apiErrorHandler.ts";

// Exercise the real route, access checks, response schemas, and PostgreSQL.
// Replace only Clerk's network boundary; never allow a client-provided role
// to stand in for the server-side private metadata check in production.
if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_URL) {
  throw new Error("This suite requires NODE_ENV=test and a development test DATABASE_URL.");
}

const fixture = randomUUID();
const conversationId = fixture;
const fixturePermitNumbers = [
  "2026-990001-CI",
  "2026-990002-CI",
  "2026-990003-CI",
  "2026-990004-CI",
];
const fixtureRecordIds = fixturePermitNumbers.map(number => `SJ-OPEN-${number}`);
const importerPermitNumber = fixturePermitNumbers[0];
const importerRecordId = `SJ-OPEN-${importerPermitNumber}`;
const ticketId = randomUUID();
const administratorAcknowledgementTicketId = randomUUID();
const ordinaryId = randomUUID();
const legacyAcknowledgedTicketId = randomUUID();
const auditFailureTicketId = randomUUID();
const auditFailureTriggerSuffix = randomUUID().replaceAll("-", "");
const currentPublicRecordId = `REF-CURRENT-${fixture}`;
const outdatedPublicRecordId = `REF-OUTDATED-${fixture}`;
const syntheticRecordId = `DEMO-D2-${fixture}`;
const staleCachedCityRecordId = `SJ-OPEN-2026-${randomUUID().replaceAll("-", "")}-CI`;
const futureCachedCityRecordId = `SJ-OPEN-2026-${randomUUID().replaceAll("-", "")}-CI`;
const currentCachedCityRecordId = `SJ-OPEN-2026-${randomUUID().replaceAll("-", "")}-CI`;
const nonCityCachedRecordId = `SJ-OPEN-2026-${randomUUID().replaceAll("-", "")}-CI`;
const applicantCreatedRecordId = `SJ-OPEN-APPLICANT-${randomUUID()}`;
const failedRefreshPermitNumbers = Array.from({ length: 4 }, () =>
  `2026-${randomUUID().replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}-CI`);
const failedRefreshRecordIds = failedRefreshPermitNumbers.map(number => `SJ-OPEN-${number}`);
const originalTime = new Date("2024-01-02T03:04:05.000Z");
const legacyAcknowledgedTime = new Date("2024-03-04T05:06:07.000Z");
const auditFailureOriginalTime = new Date("2024-02-03T04:05:06.000Z");
const importedAt = new Date();
const outdatedImportedAt = new Date(importedAt.getTime() - 48 * 60 * 60 * 1000);
const errorLogs = [];
let outputDir;
let server;
let baseUrl;
const residentTicketIds = [];

async function withFrozenTime(isoDate, callback) {
  const NativeDate = globalThis.Date;
  const fixedTime = new NativeDate(isoDate).getTime();
  globalThis.Date = class extends NativeDate {
    constructor(...args) {
      if (args.length === 0) super(fixedTime);
      else super(...args);
    }
    static now() { return fixedTime; }
  };
  try {
    return await callback();
  } finally {
    globalThis.Date = NativeDate;
  }
}

async function request(method, route, actor = "anonymous", body) {
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers: { "x-test-actor": actor, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsedBody = text;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    // Express's default error response is HTML; preserve it for failure assertions.
  }
  return { status: response.status, body: parsedBody };
}

const queue = actor => request("GET", "/workspace/escalations", actor);
const ack = (actor, id = ticketId) =>
  request("POST", `/workspace/escalations/${encodeURIComponent(id)}/acknowledge`, actor);

before(async () => {
  // The generated module must live under this package so Node can resolve
  // external workspace and npm packages from its own node_modules.
  outputDir = await mkdtemp(new URL("./.workspace-route-", import.meta.url).pathname);
  // Bundling the source route keeps this suite runnable with the repo's
  // existing esbuild dependency, without requiring a second TS test runner.
  const outfile = path.join(outputDir, "workspace.mjs");
  await esbuild.build({
    entryPoints: [new URL("../src/routes/workspace.ts", import.meta.url).pathname],
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
                resident: {},
                building: { staffRole: "reviewer", staffDepartment: "Building" },
                unassigned: { staffRole: "reviewer" },
                fire: { staffRole: "reviewer", staffDepartment: "Fire" },
                economic: { staffRole: "reviewer", staffDepartment: "Economic Development" },
              })[id] ?? {}
            }) } };
          `,
          loader: "js",
        }));
      },
    }],
  });
  const { default: router } = await import(pathToFileURL(outfile).href);
  await db.insert(workspaceConversationsTable).values({
    id: conversationId, ownerId: "resident", mode: "research", title: "Test safety report",
  });
  await db.insert(workspaceMessagesTable).values([
    { id: ticketId, conversationId, role: "assistant", content: "Prototype safety warning", status: "high-urgency", updatedAt: originalTime },
    { id: administratorAcknowledgementTicketId, conversationId, role: "assistant", content: "City Staff administrator acknowledgement test", status: "high-urgency", updatedAt: originalTime },
    { id: ordinaryId, conversationId, role: "assistant", content: "Regular guidance", status: "complete" },
    {
      id: legacyAcknowledgedTicketId,
      conversationId,
      role: "assistant",
      content: "Older acknowledged safety warning",
      status: "high-urgency-acknowledged",
      updatedAt: legacyAcknowledgedTime,
    },
  ]);
  await db.insert(applicationsTable).values([
    {
      id: currentPublicRecordId, ownerId: "private-owner", applicantKey: "private-applicant",
      businessName: "Private Current Permit Applicant", businessCategory: "Commercial",
      requestType: "Building permit", status: "Issued", assignedDepartment: "Building",
      applicantLanguage: "English", submittedAt: null, description: "Private current record description",
      notes: "Private note", synthetic: false, sourceUrl: "https://data.sanjoseca.gov/dataset/last-30-days-building-permits",
      sourceDataset: "City of San José · Last 30 days building permits",
      sourceDate: new Date("2026-09-25T12:00:00.000Z"), sourceImportedAt: importedAt,
      plan: {}, createdAt: importedAt, updatedAt: importedAt,
    },
    {
      id: outdatedPublicRecordId, ownerId: "private-owner", applicantKey: "private-applicant",
      businessName: "Private Outdated Permit Applicant", businessCategory: "Commercial",
      requestType: "Building permit", status: "Issued", assignedDepartment: "Building",
      applicantLanguage: "English", submittedAt: null, description: "Private outdated record description",
      notes: "Private note", synthetic: false, sourceUrl: "https://data.sanjoseca.gov/dataset/last-30-days-building-permits",
      sourceDataset: "City of San José · Last 30 days building permits",
      sourceDate: new Date("2026-09-20T12:00:00.000Z"), sourceImportedAt: outdatedImportedAt,
      plan: {}, createdAt: outdatedImportedAt, updatedAt: outdatedImportedAt,
    },
    {
      id: syntheticRecordId, ownerId: null, applicantKey: null,
      businessName: "Synthetic Reference Example", businessCategory: "Example",
      requestType: "Prototype example", status: "Demo", assignedDepartment: "Not provided",
      applicantLanguage: "English", submittedAt: null, description: "Fictional example record",
      notes: null, synthetic: true, sourceUrl: null, sourceDataset: null,
      sourceDate: null, sourceImportedAt: null, plan: {}, createdAt: importedAt, updatedAt: importedAt,
    },
  ]);
  const app = express();
  app.use((req, _res, next) => {
    req.log = {
      info() {},
      warn() {},
      error(fields, message) { errorLogs.push({ fields, message }); },
    };
    next();
  });
  app.use(express.json());
  app.use("/api", router);
  app.get("/api/__test/unhandled-error", (_req, _res, next) => {
    next(new Error("sensitive database connection details"));
  });
  app.use(apiErrorHandler);
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await db.delete(workspaceAcknowledgementsTable)
    .where(inArray(workspaceAcknowledgementsTable.ticketId, [
      ticketId, administratorAcknowledgementTicketId, legacyAcknowledgedTicketId, auditFailureTicketId,
      ...residentTicketIds,
    ]));
  await db.delete(workspaceMessagesTable).where(eq(workspaceMessagesTable.conversationId, conversationId));
  await db.delete(workspaceConversationsTable).where(eq(workspaceConversationsTable.id, conversationId));
  await db.delete(applicationsTable)
    .where(inArray(applicationsTable.id, [
      currentPublicRecordId, outdatedPublicRecordId, syntheticRecordId, importerRecordId,
      ...fixtureRecordIds,
      ...failedRefreshRecordIds,
      staleCachedCityRecordId, futureCachedCityRecordId, currentCachedCityRecordId,
      nonCityCachedRecordId, applicantCreatedRecordId,
    ]));
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
  await pool.end();
});

test("uncaught API errors return generic JSON and retain details in server logs", async () => {
  const response = await request("GET", "/__test/unhandled-error");
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "Internal server error." });
  assert.doesNotMatch(JSON.stringify(response.body), /sensitive database connection details/);

  const failureLog = errorLogs.at(-1);
  assert.equal(failureLog.message, "Unhandled API error");
  assert.equal(failureLog.fields.err.message, "sensitive database connection details");
});

test("reference endpoints and prototype freshness states match generated response schemas", async () => {
  const sourceResponse = await request("GET", "/workspace/prototype-sources");
  assert.equal(sourceResponse.status, 200);
  const sources = ListWorkspacePrototypeSourcesResponse.parse(sourceResponse.body);
  assert.ok(sources.length > 0);
  assert.ok(sources.every(source => source.state === "demo"));
  assert.ok(sources.every(source => /Synthetic example/.test(source.content)));
  assert.ok(sources.every(source => source.officialReferenceUrl.startsWith("https://www.sanjoseca.gov/") ||
    source.officialReferenceUrl.startsWith("https://permits.sanjoseca.gov/")));

  const outdatedSources = ListWorkspacePrototypeSourcesResponse.parse(
    prototypeSources(new Date("2027-09-30T00:00:00.000Z")),
  );
  assert.ok(outdatedSources.every(source => source.state === "outdated"));
  const unavailableSources = ListWorkspacePrototypeSourcesResponse.parse(
    prototypeSources(new Date("2026-09-28T00:00:00.000Z")),
  );
  assert.ok(unavailableSources.every(source => source.state === "unavailable"));

  const publicResponse = await request(
    "GET",
    `/workspace/records?mode=live&search=${encodeURIComponent(fixture)}`,
  );
  assert.equal(publicResponse.status, 200);
  const publicRecords = ListWorkspaceRecordsResponse.parse(publicResponse.body);
  assert.deepEqual(
    new Set(publicRecords.map(record => record.id)),
    new Set([currentPublicRecordId, outdatedPublicRecordId]),
    JSON.stringify(publicResponse.body),
  );
  const current = publicRecords.find(record => record.id === currentPublicRecordId);
  const outdated = publicRecords.find(record => record.id === outdatedPublicRecordId);
  assert.equal(current.synthetic, false);
  assert.equal(current.freshness, "cached");
  assert.equal(current.sourceUrl, "https://data.sanjoseca.gov/dataset/last-30-days-building-permits");
  assert.equal(outdated.freshness, "outdated");
  assert.equal(outdated.sourceImportedAt.toISOString(), outdatedImportedAt.toISOString());
  assert.doesNotMatch(JSON.stringify(publicResponse.body), /Private (Current|Outdated) Permit Applicant|private-owner|private-applicant|Private note/);

  const demoResponse = await request(
    "GET",
    `/workspace/records?mode=research&search=${encodeURIComponent(syntheticRecordId)}`,
  );
  const demoRecords = ListWorkspaceRecordsResponse.parse(demoResponse.body);
  assert.equal(demoRecords.length, 1);
  assert.equal(demoRecords[0].synthetic, true);
  assert.equal(demoRecords[0].freshness, "demo");
  assert.equal(demoRecords[0].sourceUrl, null);
  assert.equal(demoRecords[0].sourceDate, null);
  assert.equal(demoRecords[0].sourceImportedAt, null);
});

test("City permit import persists and returns only allowlisted public metadata", async () => {
  const privateValues = {
    applicant: "PRIVATE_APPLICANT_SENTINEL",
    owner: "PRIVATE_OWNER_SENTINEL",
    contractor: "PRIVATE_CONTRACTOR_SENTINEL",
    parcel: "PRIVATE_PARCEL_SENTINEL",
  };
  await db.delete(applicationsTable).where(inArray(applicationsTable.id, fixtureRecordIds));
  const existingRecordTime = new Date(Date.now() - 60_000);
  await db.insert(applicationsTable).values({
    id: importerRecordId,
    ownerId: privateValues.owner,
    applicantKey: privateValues.applicant,
    businessName: privateValues.applicant,
    businessCategory: privateValues.contractor,
    requestType: privateValues.contractor,
    status: "Private",
    assignedDepartment: privateValues.owner,
    applicantLanguage: privateValues.applicant,
    submittedAt: existingRecordTime,
    description: privateValues.parcel,
    notes: Object.values(privateValues).join(" "),
    synthetic: true,
    sourceUrl: privateValues.owner,
    sourceDataset: privateValues.contractor,
    sourceDate: existingRecordTime,
    sourceImportedAt: existingRecordTime,
    plan: { applicant: privateValues.applicant, owner: privateValues.owner, contractor: privateValues.contractor, parcel: privateValues.parcel },
    createdAt: existingRecordTime,
    updatedAt: existingRecordTime,
  });
  const csv = await readFile(
    new URL("./fixtures/public-permits-issue-dates.csv", import.meta.url),
    "utf8",
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(csv, { status: 200 });
  let publicResults;
  try {
    publicResults = await withFrozenTime("2026-09-30T09:15:00.000Z", async () => {
      await refreshPublicPermits();
      globalThis.fetch = originalFetch;
      const results = new Map();
      for (const recordId of fixtureRecordIds) {
        const response = await request(
          "GET",
          `/workspace/records?mode=live&search=${encodeURIComponent(recordId)}`,
        );
        assert.equal(response.status, 200);
        results.set(recordId, ListWorkspaceRecordsResponse.parse(response.body));
      }
      return results;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const savedRows = await db.select().from(applicationsTable)
    .where(inArray(applicationsTable.id, fixtureRecordIds));
  assert.deepEqual(savedRows.map(row => row.id), [importerRecordId],
    "only the in-window issue date should be saved");
  const [persisted] = await db.select().from(applicationsTable)
    .where(eq(applicationsTable.id, importerRecordId));
  assert.ok(persisted, "the CSV row should be imported");
  assert.equal(persisted.ownerId, null);
  assert.equal(persisted.applicantKey, null);
  assert.equal(persisted.businessName, "Property at 55 Sample Way");
  assert.equal(persisted.businessCategory, "Restaurant");
  assert.equal(persisted.requestType, "Interior renovation");
  assert.equal(persisted.status, "Issued");
  assert.equal(persisted.assignedDepartment, "Not provided");
  assert.equal(persisted.applicantLanguage, "Not provided");
  assert.equal(persisted.submittedAt, null);
  assert.equal(persisted.notes, null);
  assert.equal(persisted.synthetic, false);
  assert.equal(persisted.sourceUrl, "https://data.sanjoseca.gov/dataset/last-30-days-building-permits");
  assert.equal(persisted.sourceDataset, "City of San José · Last 30 days building permits");
  assert.equal(persisted.plan.intake.businessName, "Property at 55 Sample Way");
  assert.equal(persisted.plan.intake.address, "55 Sample Way");
  for (const value of Object.values(privateValues)) {
    assert.ok(!JSON.stringify(persisted).includes(value), `sensitive value persisted: ${value}`);
  }

  const publicRecords = publicResults.get(importerRecordId);
  assert.equal(publicRecords.length, 1);
  const [publicRecord] = publicRecords;
  assert.deepEqual(Object.keys(publicRecord).sort(), [
    "category", "department", "description", "freshness", "id", "language",
    "sourceDate", "sourceImportedAt", "sourceUrl", "status", "synthetic", "updatedAt",
  ]);
  assert.equal(publicRecord.id, importerRecordId);
  assert.equal(publicRecord.category, "Restaurant");
  assert.equal(publicRecord.description, "Commercial/industrial building permit metadata");
  assert.equal(publicRecord.synthetic, false);
  for (const value of Object.values(privateValues)) {
    assert.ok(!JSON.stringify(publicRecords).includes(value), `sensitive value returned: ${value}`);
  }
  for (const rejectedRecordId of fixtureRecordIds.slice(1)) {
    assert.deepEqual(
      publicResults.get(rejectedRecordId),
      [],
      `rejected issue date must not be returned publicly: ${rejectedRecordId}`,
    );
  }
});

async function seedCachedCityReference(id) {
  const savedAt = new Date(Date.now() - 60_000);
  const sourceDate = new Date(Date.now() - 60_000);
  await db.insert(applicationsTable).values({
    id,
    ownerId: null,
    applicantKey: null,
    businessName: "Property at 99 Existing Street",
    businessCategory: "Existing public category",
    requestType: "Existing public work",
    status: "Issued",
    assignedDepartment: "Not provided",
    applicantLanguage: "Not provided",
    submittedAt: null,
    description: "Existing public reference",
    notes: null,
    synthetic: false,
    sourceUrl: "https://data.sanjoseca.gov/dataset/last-30-days-building-permits",
    sourceDataset: "City of San José · Last 30 days building permits",
    sourceDate,
    sourceImportedAt: savedAt,
    plan: {},
    createdAt: savedAt,
    updatedAt: savedAt,
  });
}

async function readPublicReference(id) {
  const response = await request(
    "GET",
    `/workspace/records?mode=live&search=${encodeURIComponent(id)}`,
  );
  assert.equal(response.status, 200);
  return ListWorkspaceRecordsResponse.parse(response.body);
}

test("failed City download keeps existing references unchanged and available", async () => {
  const [existingRecordId, attemptedRecordId] = failedRefreshRecordIds;
  await seedCachedCityReference(existingRecordId);
  const [before] = await db.select().from(applicationsTable)
    .where(eq(applicationsTable.id, existingRecordId));
  const publicBefore = await readPublicReference(existingRecordId);
  assert.equal(publicBefore.length, 1);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("City dataset unavailable", { status: 503 });
  try {
    await assert.rejects(refreshPublicPermits(), /City permit dataset responded 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const [after] = await db.select().from(applicationsTable)
    .where(eq(applicationsTable.id, existingRecordId));
  assert.deepEqual(after, before, "failed download must not update or remove saved references");
  assert.deepEqual(await readPublicReference(existingRecordId), publicBefore);
  assert.deepEqual(await readPublicReference(attemptedRecordId), []);
});

test("invalid City CSV after a valid row keeps existing references and writes no new rows", async () => {
  const [existingRecordId, attemptedRecordId] = failedRefreshRecordIds.slice(2);
  await seedCachedCityReference(existingRecordId);
  const [before] = await db.select().from(applicationsTable)
    .where(eq(applicationsTable.id, existingRecordId));
  const publicBefore = await readPublicReference(existingRecordId);
  assert.equal(publicBefore.length, 1);

  const today = new Date();
  const validRow = [
    failedRefreshPermitNumbers[3],
    "Commercial/Industrial",
    "100 New Street",
    "New tenant improvement",
    "Restaurant",
    "Interior renovation",
    `${today.getUTCMonth() + 1}/${today.getUTCDate()}/${today.getUTCFullYear()}`,
  ];
  const headers = [
    "FOLDERNUMBER", "FOLDERDESC", "gx_location", "FOLDERNAME",
    "SUBTYPEDESCRIPTION", "WORKDESCRIPTION", "ISSUEDATE",
  ];
  const quoteRow = values => values.map(value =>
    `"${String(value).replaceAll('"', '""')}"`).join(",");
  const csv = `${headers.join(",")}\n${quoteRow(validRow)}\n"unterminated field`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(csv, { status: 200 });
  try {
    await assert.rejects(refreshPublicPermits(), /Unterminated CSV quoted field/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const [after] = await db.select().from(applicationsTable)
    .where(eq(applicationsTable.id, existingRecordId));
  assert.deepEqual(after, before, "CSV parse failure must not update or remove saved references");
  assert.deepEqual(await readPublicReference(existingRecordId), publicBefore);
  const attemptedRows = await db.select().from(applicationsTable)
    .where(eq(applicationsTable.id, attemptedRecordId));
  assert.deepEqual(attemptedRows, [], "valid rows preceding the CSV error must not be written");
  assert.deepEqual(await readPublicReference(attemptedRecordId), []);
});

test("successful City refresh removes previously cached stale and future-dated records only", async () => {
  const recentImport = new Date(Date.now() - 60_000);
  const issueToday = new Date();
  issueToday.setUTCHours(12, 0, 0, 0);
  const staleIssueDate = new Date(issueToday);
  staleIssueDate.setUTCDate(staleIssueDate.getUTCDate() - 31);
  const futureIssueDate = new Date(issueToday);
  futureIssueDate.setUTCDate(futureIssueDate.getUTCDate() + 1);
  const cityDataset = "City of San José · Last 30 days building permits";
  const base = {
    ownerId: null,
    applicantKey: null,
    businessName: "Property at 55 Sample Way",
    businessCategory: "Commercial",
    requestType: "Building permit",
    status: "Issued",
    assignedDepartment: "Not provided",
    applicantLanguage: "Not provided",
    submittedAt: null,
    description: "Cached public permit reference",
    notes: null,
    synthetic: false,
    sourceUrl: "https://data.sanjoseca.gov/dataset/last-30-days-building-permits",
    sourceDataset: cityDataset,
    sourceImportedAt: recentImport,
    plan: {},
    createdAt: recentImport,
    updatedAt: recentImport,
  };
  await db.insert(applicationsTable).values([
    { ...base, id: staleCachedCityRecordId, sourceDate: staleIssueDate },
    { ...base, id: futureCachedCityRecordId, sourceDate: futureIssueDate },
    { ...base, id: currentCachedCityRecordId, sourceDate: issueToday },
    {
      ...base, id: nonCityCachedRecordId, sourceDataset: "Another permit source",
      sourceDate: futureIssueDate,
    },
    {
      ...base, id: applicantCreatedRecordId, ownerId: "applicant-owner",
      applicantKey: "applicant-key", synthetic: true, sourceDate: futureIssueDate,
    },
  ]);

  const headers = [
    "FOLDERNUMBER", "FOLDERDESC", "gx_location", "FOLDERNAME",
    "SUBTYPEDESCRIPTION", "WORKDESCRIPTION", "ISSUEDATE",
  ];
  const today = new Date();
  const row = [
    importerPermitNumber, "Commercial/Industrial", "55 Sample Way",
    "Tenant improvement", "Restaurant", "Interior renovation",
    `${today.getUTCMonth() + 1}/${today.getUTCDate()}/${today.getUTCFullYear()}`,
  ];
  const csv = `${headers.join(",")}\n${row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")}\n`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(csv, { status: 200 });
  try {
    await refreshPublicPermits();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const retained = await db.select().from(applicationsTable)
    .where(inArray(applicationsTable.id, [
      staleCachedCityRecordId, futureCachedCityRecordId, currentCachedCityRecordId,
      nonCityCachedRecordId, applicantCreatedRecordId,
    ]));
  const retainedIds = new Set(retained.map(record => record.id));
  assert.ok(!retainedIds.has(staleCachedCityRecordId), "stale City reference should be deleted");
  assert.ok(!retainedIds.has(futureCachedCityRecordId), "future-dated City reference should be deleted");
  assert.ok(retainedIds.has(currentCachedCityRecordId), "in-window City reference should remain");
  assert.ok(retainedIds.has(nonCityCachedRecordId), "non-City reference should remain");
  assert.ok(retainedIds.has(applicantCreatedRecordId), "applicant-created record should remain");

  for (const id of [staleCachedCityRecordId, futureCachedCityRecordId]) {
    const response = await request("GET", `/workspace/records?mode=live&search=${encodeURIComponent(id)}`);
    assert.deepEqual(ListWorkspaceRecordsResponse.parse(response.body), []);
  }
  const currentResponse = await request(
    "GET", `/workspace/records?mode=live&search=${encodeURIComponent(currentCachedCityRecordId)}`,
  );
  assert.equal(ListWorkspaceRecordsResponse.parse(currentResponse.body).length, 1);
});

test("queue and acknowledgement reject anonymous, resident, and unassigned accounts", async () => {
  for (const [actor, expected] of [["anonymous", 401], ["resident", 403], ["unassigned", 403]]) {
    assert.equal((await queue(actor)).status, expected, `${actor} queue`);
    assert.equal((await ack(actor)).status, expected, `${actor} acknowledgement`);
  }
  assert.equal((await queue("building")).status, 200, "every approved City Staff reviewer can access the queue");
  assert.equal(
    (await ack("building", administratorAcknowledgementTicketId)).status,
    200,
    "every approved City Staff reviewer can acknowledge tickets",
  );
  const [row] = await db.select().from(workspaceMessagesTable).where(eq(workspaceMessagesTable.id, ticketId));
  assert.equal(row.status, "high-urgency");
  assert.equal(row.updatedAt.toISOString(), originalTime.toISOString());
});

test("authorized queue lists only urgent tickets without resident details or dispatch promises", async () => {
  for (const actor of ["fire", "economic", "building"]) {
    const response = await queue(actor);
    assert.equal(response.status, 200);
    const item = response.body.find(row => row.ticketId === ticketId);
    assert.ok(item);
    assert.equal(response.body.some(row => row.ticketId === ordinaryId), false);
    assert.equal(item.status, "Awaiting workspace review acknowledgement");
    assert.equal(item.acknowledgedAt, null);
    assert.match(item.deliveryStatus, /not verified; no automatic dispatch or retries/i);
    assert.doesNotMatch(JSON.stringify(item), /ownerId|conversationId|Prototype safety warning/i);
  }
  assert.equal((await ack("fire", ordinaryId)).status, 404);
  assert.equal((await ack("fire", randomUUID())).status, 404);
  assert.equal((await ack("fire", "bad-id")).status, 400);
});

test("legacy acknowledged tickets stay acknowledged without fabricated reviewer identity", async () => {
  const [persisted] = await db.select().from(workspaceMessagesTable)
    .where(eq(workspaceMessagesTable.id, legacyAcknowledgedTicketId));
  assert.equal(persisted.status, "high-urgency-acknowledged");
  assert.equal(persisted.updatedAt.toISOString(), legacyAcknowledgedTime.toISOString());

  const auditRows = await db.select().from(workspaceAcknowledgementsTable)
    .where(eq(workspaceAcknowledgementsTable.ticketId, legacyAcknowledgedTicketId));
  assert.equal(auditRows.length, 0, "legacy acknowledged ticket has no audit event");

  const response = await queue("fire");
  assert.equal(response.status, 200);
  const item = response.body.find(row => row.ticketId === legacyAcknowledgedTicketId);
  assert.ok(item);
  assert.equal(item.status, "Acknowledged in workspace review queue");
  assert.equal(item.acknowledgedAt, legacyAcknowledgedTime.toISOString());
  assert.equal(item.acknowledgedBy, null);
  assert.equal(item.acknowledgedDepartment, null);
});

test("an audit-write failure rolls back the urgent ticket acknowledgement", async () => {
  const triggerName = `reject_ack_audit_${auditFailureTriggerSuffix}`;
  const functionName = `reject_ack_audit_${auditFailureTriggerSuffix}`;
  await db.insert(workspaceMessagesTable).values({
    id: auditFailureTicketId,
    conversationId,
    role: "assistant",
    content: "Prototype safety warning for audit failure test",
    status: "high-urgency",
    updatedAt: auditFailureOriginalTime,
  });

  let functionCreated = false;
  let triggerCreated = false;
  try {
    await pool.query(`
      CREATE FUNCTION public.${functionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'controlled audit write failure';
      END;
      $$;
    `);
    functionCreated = true;
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON public.workspace_acknowledgements
      FOR EACH ROW
      WHEN (NEW.ticket_id = '${auditFailureTicketId}')
      EXECUTE FUNCTION public.${functionName}();
    `);
    triggerCreated = true;

    const response = await ack("fire", auditFailureTicketId);
    assert.equal(response.status, 500, "the request must not report a successful acknowledgement");
    assert.deepEqual(response.body, { error: "Internal server error." });
    assert.doesNotMatch(JSON.stringify(response.body), /controlled audit write failure|workspace_acknowledgements/);
    assert.notEqual(response.body.status, "Acknowledged in workspace review queue");
    const failureLog = errorLogs.at(-1);
    assert.equal(failureLog.fields.ticketId, auditFailureTicketId);
    assert.match(failureLog.fields.err.message, /Failed query: insert into "workspace_acknowledgements"/);
    assert.equal(failureLog.message, "Failed to save urgent ticket acknowledgement");

    const [persisted] = await db.select().from(workspaceMessagesTable)
      .where(eq(workspaceMessagesTable.id, auditFailureTicketId));
    assert.equal(persisted.status, "high-urgency");
    assert.equal(persisted.updatedAt.toISOString(), auditFailureOriginalTime.toISOString());

    const auditRows = await db.select().from(workspaceAcknowledgementsTable)
      .where(eq(workspaceAcknowledgementsTable.ticketId, auditFailureTicketId));
    assert.equal(auditRows.length, 0, "a failed audit write must not commit an audit row");
  } finally {
    if (triggerCreated) {
      await pool.query(`DROP TRIGGER ${triggerName} ON public.workspace_acknowledgements`);
    }
    if (functionCreated) {
      await pool.query(`DROP FUNCTION public.${functionName}()`);
    }
  }

  const retry = await ack("fire", auditFailureTicketId);
  assert.equal(retry.status, 200, "the same staff member can retry after the audit store recovers");
  assert.equal(retry.body.status, "Acknowledged in workspace review queue");
  assert.equal(retry.body.acknowledgedBy, "fire");
  assert.equal(retry.body.acknowledgedDepartment, "Fire");

  const [acknowledgedTicket] = await db.select().from(workspaceMessagesTable)
    .where(eq(workspaceMessagesTable.id, auditFailureTicketId));
  assert.equal(acknowledgedTicket.status, "high-urgency-acknowledged");
  assert.equal(acknowledgedTicket.updatedAt.toISOString(), retry.body.acknowledgedAt);

  const auditRowsAfterRetry = await db.select().from(workspaceAcknowledgementsTable)
    .where(eq(workspaceAcknowledgementsTable.ticketId, auditFailureTicketId));
  assert.equal(auditRowsAfterRetry.length, 1, "a recovered retry creates exactly one audit event");
  assert.equal(auditRowsAfterRetry[0].ticketId, auditFailureTicketId);
  assert.equal(auditRowsAfterRetry[0].staffUserId, "fire");
  assert.equal(auditRowsAfterRetry[0].staffDepartment, "Fire");
  assert.equal(auditRowsAfterRetry[0].acknowledgedAt.toISOString(), retry.body.acknowledgedAt);
});

test("simultaneous reviewers share the first acknowledgement and create one audit event", async () => {
  const results = await Promise.all([ack("fire"), ack("economic")]);
  assert.ok(results.every(result => result.status === 200), JSON.stringify(results));
  const timestamps = results.map(result => result.body.acknowledgedAt);
  assert.ok(timestamps[0]);
  assert.equal(new Set(timestamps).size, 1, "both requests return the original winning timestamp");
  assert.ok(new Date(timestamps[0]) > originalTime);
  assert.ok(results.every(result => result.body.status === "Acknowledged in workspace review queue"));

  const auditRowsBeforeRetry = await db.select().from(workspaceAcknowledgementsTable)
    .where(eq(workspaceAcknowledgementsTable.ticketId, ticketId));
  assert.equal(auditRowsBeforeRetry.length, 1, "the ticket has exactly one audit event");
  const [auditBeforeRetry] = auditRowsBeforeRetry;
  assert.ok(["fire", "economic", "building"].includes(auditBeforeRetry.staffUserId));
  assert.equal(auditBeforeRetry.staffDepartment, {
    fire: "Fire",
    economic: "Economic Development",
    building: "Building",
  }[auditBeforeRetry.staffUserId]);
  assert.equal(auditBeforeRetry.acknowledgedAt.toISOString(), timestamps[0]);
  for (const result of results) {
    assert.equal(result.body.acknowledgedBy, auditBeforeRetry.staffUserId);
    assert.equal(result.body.acknowledgedDepartment, auditBeforeRetry.staffDepartment);
    assert.equal(result.body.acknowledgedAt, auditBeforeRetry.acknowledgedAt.toISOString());
  }

  const otherReviewer = auditBeforeRetry.staffUserId === "fire" ? "economic" : "fire";
  const repeated = await ack(otherReviewer);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.acknowledgedAt, timestamps[0]);
  assert.equal(repeated.body.acknowledgedBy, auditBeforeRetry.staffUserId);
  assert.equal(repeated.body.acknowledgedDepartment, auditBeforeRetry.staffDepartment);
  const auditRowsAfterRetry = await db.select().from(workspaceAcknowledgementsTable)
    .where(eq(workspaceAcknowledgementsTable.ticketId, ticketId));
  assert.equal(auditRowsAfterRetry.length, 1, "a repeat request does not add an audit event");
  assert.deepEqual(auditRowsAfterRetry[0], auditBeforeRetry, "a repeat request does not modify the winning audit event");

  const [persisted] = await db.select().from(workspaceMessagesTable)
    .where(and(eq(workspaceMessagesTable.id, ticketId), eq(workspaceMessagesTable.status, "high-urgency-acknowledged")));
  assert.ok(persisted);
  assert.equal(persisted.updatedAt.toISOString(), auditBeforeRetry.acknowledgedAt.toISOString());
  const reloaded = await queue("economic");
  const queueTicket = reloaded.body.find(row => row.ticketId === ticketId);
  assert.equal(queueTicket.acknowledgedAt, timestamps[0]);
  assert.equal(queueTicket.acknowledgedBy, auditBeforeRetry.staffUserId);
  assert.equal(queueTicket.acknowledgedDepartment, auditBeforeRetry.staffDepartment);
  assert.equal((await ack("resident")).status, 403, "resident cannot change an acknowledged ticket");
});

const staffIdentityFields = new Set(["acknowledgedBy", "acknowledgedDepartment", "staffUserId", "staffDepartment"]);

function assertNoStaffIdentity(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoStaffIdentity);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(staffIdentityFields.has(key), false, `resident response must not expose ${key}`);
      assertNoStaffIdentity(nested);
    }
  }
}

function assertResidentMessageShape(message) {
  assert.deepEqual(Object.keys(message).sort(), ["content", "createdAt", "id", "role"]);
}

test("hazardous resident message creates a ticket but never claims delivery or staff action", async () => {
  const sent = await request("POST", `/workspace/conversations/${conversationId}/messages`, "resident", {
    content: "There is a gas leak near my shop",
  });
  assert.equal(sent.status, 201);
  residentTicketIds.push(sent.body.message.id);
  assertNoStaffIdentity(sent.body);
  assertResidentMessageShape(sent.body.message);
  const [saved] = await db.select().from(workspaceMessagesTable).where(eq(workspaceMessagesTable.id, sent.body.message.id));
  assert.equal(saved.status, "high-urgency");
  assert.match(sent.body.message.content, /leave the area and contact emergency services/i);
  assert.match(sent.body.message.content, /has not notified emergency responders or City staff/i);
  assert.match(sent.body.escalation, /No email delivery or City dispatch confirmed/i);
  assert.doesNotMatch(sent.body.message.content, /staff (has|have) acknowledged|email (was|has been) sent/i);
  const newTicket = sent.body.message.id;
  const staffQueue = await queue("fire");
  assert.equal(staffQueue.body.find(row => row.ticketId === newTicket)?.status, "Awaiting workspace review acknowledgement");
  assert.equal(staffQueue.body.find(row => row.ticketId === newTicket)?.acknowledgedAt, null);

  const messages = await request("GET", `/workspace/conversations/${conversationId}/messages`, "resident");
  assert.equal(messages.status, 200);
  assertNoStaffIdentity(messages.body);
  const residentAnswer = messages.body.find(row => row.id === newTicket);
  assertResidentMessageShape(residentAnswer);
  assert.equal(residentAnswer.content, sent.body.message.content);
  assert.equal((await ack("economic", newTicket)).status, 200);
  const reloaded = await request("GET", `/workspace/conversations/${conversationId}/messages`, "resident");
  assertNoStaffIdentity(reloaded.body);
  const reloadedResidentAnswer = reloaded.body.find(row => row.id === newTicket);
  assertResidentMessageShape(reloadedResidentAnswer);
  assert.equal(reloadedResidentAnswer.content, residentAnswer.content,
    "internal acknowledgement does not silently alter the resident-facing warning");
  assert.equal((await request("GET", `/workspace/conversations/${conversationId}/messages`, "fire")).status, 404);
});