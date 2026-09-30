import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import esbuild from "esbuild";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, pool, applicationsTable, applicationDocumentsTable, applicationDocumentAuditTable, statusHistoryTable,
} from "@workspace/db";
import { apiErrorHandler } from "../src/middlewares/apiErrorHandler.ts";

if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_URL) {
  throw new Error("This suite requires NODE_ENV=test and a development test DATABASE_URL.");
}

const draftId = randomUUID();
const otherDraftId = randomUUID();
const submittedId = randomUUID();
const cityId = `SJ-OPEN-${randomUUID()}`;
const raceId = randomUUID();
const lockedRaceId = randomUUID();
const capId = randomUUID();
const expiryRaceId = randomUUID();
const expiryWinsId = randomUUID();
const applicationIds = [draftId, otherDraftId, submittedId, cityId, raceId, lockedRaceId, capId, expiryRaceId, expiryWinsId];
let outputDir;
let server;
let baseUrl;
const errorLogs = [];

function planFor(status, intakeOverrides = {}) {
  return {
    intake: {
      address: "1 Sample Way",
      description: "Test permit application",
      businessType: "restaurant",
      modifications: [],
      businessName: "Test business",
      ...intakeOverrides,
    },
    matched: ["building-permits"],
    status,
    language: "en",
  };
}

async function request(method, route, actor = "anonymous", body) {
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers: { "x-test-actor": actor, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return response;
}

async function upload(actor, appId = draftId, metadata = {
  name: "supporting.pdf", size: 9, contentType: "application/pdf",
}) {
  const response = await request("POST", `/applications/${appId}/documents/upload-url`, actor, metadata);
  const body = await response.json();
  return { response, body };
}

function stageUpload({
  size = 9, contentType = "application/pdf", signature = Buffer.from("%PDF-1.7\n"), stagingObjectId,
} = {}) {
  const mock = globalThis.__applicationDocumentStorageMock;
  const objectId = stagingObjectId ?? mock.lastObjectId;
  const object = mock.objects.get(objectId) ?? { stagingVersions: new Map(), final: null, nextGeneration: 0 };
  const generation = String(++object.nextGeneration);
  object.stagingVersions.set(generation, { size, contentType, signature, bytes: signature });
  object.currentGeneration = generation;
  mock.objects.set(objectId, object);
}

before(async () => {
  globalThis.__applicationDocumentStorageMock = {
    objects: new Map(), lastObjectId: null, deleteStagingCalls: new Map(), promoteHook: null, inspectHook: null,
  };
  outputDir = await mkdtemp(new URL("./.application-documents-", import.meta.url).pathname);
  const outfile = path.join(outputDir, "applications.mjs");
  await esbuild.build({
    entryPoints: [new URL("../src/routes/applications.ts", import.meta.url).pathname],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [{
      name: "mock-clerk-and-private-document-storage",
      setup(build) {
        build.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "clerk", namespace: "test" }));
        build.onLoad({ filter: /^clerk$/, namespace: "test" }, () => ({
          contents: `
            export const getAuth = req => ({ userId: req.headers["x-test-actor"] === "anonymous" ? null : req.headers["x-test-actor"] });
            export const clerkClient = { users: { getUser: async id => ({ privateMetadata: ({
              owner: {},
              stranger: {},
              submitter: {},
              building: { staffRole: "reviewer", staffDepartment: "Building" },
              fire: { staffRole: "reviewer", staffDepartment: "Fire" },
              economic: { staffRole: "reviewer", staffDepartment: "Economic Development" },
              unassigned: { staffRole: "reviewer" },
            })[id] ?? {} }) } };
          `,
          loader: "js",
        }));
        build.onResolve({ filter: /applicationDocumentStorage(?:\.ts)?$/ }, () => ({
          path: "document-storage", namespace: "mock-storage",
        }));
        build.onLoad({ filter: /.*/, namespace: "mock-storage" }, () => ({
          contents: `
            import { Readable } from "node:stream";
            import { randomUUID } from "node:crypto";
            const mock = globalThis.__applicationDocumentStorageMock ??= {
              objects: new Map(), lastObjectId: null, deleteStagingCalls: new Map(), promoteHook: null, inspectHook: null,
            };
            export const SIGNED_UPLOAD_URL_TTL_MS = 15 * 60 * 1000;
            export const SIGNED_UPLOAD_IN_FLIGHT_GRACE_MS = 15 * 60 * 1000;
            export const applicationDocumentStorage = {
              async createUploadUrl(stagingObjectId) {
                mock.lastObjectId = stagingObjectId;
                mock.objects.set(stagingObjectId, { stagingVersions: new Map(), final: null, nextGeneration: 0 });
                return { url: "https://storage.example.test/signed-upload", expiresAt: new Date(Date.now() + SIGNED_UPLOAD_URL_TTL_MS) };
              },
              async inspect(stagingObjectId) {
                const object = mock.objects.get(stagingObjectId);
                const version = object?.stagingVersions.get(object.currentGeneration);
                if (!version) throw new Error("mock staging generation is missing");
                if (mock.inspectHook) await mock.inspectHook();
                return { ...version, generation: object.currentGeneration };
              },
              async promote(stagingObjectId, finalObjectId, sourceGeneration, documentId) {
                if (mock.promoteHook) await mock.promoteHook();
                const source = mock.objects.get(stagingObjectId)?.stagingVersions.get(sourceGeneration);
                if (!source) throw new Error("mock source generation is missing");
                const existing = mock.objects.get(finalObjectId)?.final;
                if (existing) {
                  if (existing.documentId !== documentId || existing.sourceGeneration !== sourceGeneration) {
                    throw new Error("immutable final object conflict");
                  }
                  return existing.generation;
                }
                const generation = "final-" + randomUUID();
                const final = { ...source, documentId, sourceGeneration, generation };
                const destination = mock.objects.get(finalObjectId) ?? { stagingVersions: new Map(), final: null, nextGeneration: 0 };
                destination.final = final;
                mock.objects.set(finalObjectId, destination);
                return generation;
              },
              open(finalObjectId, generation) {
                const final = mock.objects.get(finalObjectId)?.final;
                if (!final || final.generation !== generation) throw new Error("mock final generation mismatch");
                return Readable.from([final.bytes]);
              },
              async deleteStaging(stagingObjectId) {
                mock.deleteStagingCalls.set(stagingObjectId, (mock.deleteStagingCalls.get(stagingObjectId) ?? 0) + 1);
                mock.objects.delete(stagingObjectId);
              },
              async deleteFinal(finalObjectId, generation, documentId) {
                const object = mock.objects.get(finalObjectId);
                if (object?.final?.documentId === documentId &&
                    (!generation || object.final.generation === generation)) mock.objects.delete(finalObjectId);
              },
            };
          `,
          loader: "js",
        }));
      },
    }],
  });
  const { default: router } = await import(pathToFileURL(outfile).href);
  const now = new Date();
  const base = {
    businessName: "Test business",
    businessCategory: "Restaurant",
    requestType: "Building Permit",
    assignedDepartment: "Building",
    applicantLanguage: "English",
    description: "Test permit application",
    synthetic: true,
    plan: {},
  };
  await db.insert(applicationsTable).values([
    { ...base, id: draftId, ownerId: "owner", applicantKey: "owner-key", status: "Draft", submittedAt: null, plan: planFor("Draft") },
    { ...base, id: otherDraftId, ownerId: "stranger", applicantKey: "stranger-key", status: "Draft", submittedAt: null, plan: planFor("Draft") },
    { ...base, id: submittedId, ownerId: "submitter", applicantKey: "submitter-key", status: "Draft — Requires Review", submittedAt: now, plan: planFor("Draft — Requires Review") },
    { ...base, id: raceId, ownerId: "owner", applicantKey: "race-key", status: "Draft", submittedAt: null, plan: planFor("Draft") },
    { ...base, id: lockedRaceId, ownerId: "owner", applicantKey: "locked-race-key", status: "Draft", submittedAt: null, plan: planFor("Draft") },
    { ...base, id: capId, ownerId: "owner", applicantKey: "cap-key", status: "Draft", submittedAt: null, plan: planFor("Draft") },
    { ...base, id: expiryRaceId, ownerId: "owner", applicantKey: "expiry-race-key", status: "Draft", submittedAt: null, plan: planFor("Draft") },
    { ...base, id: expiryWinsId, ownerId: "owner", applicantKey: "expiry-wins-key", status: "Draft", submittedAt: null, plan: planFor("Draft") },
    {
      ...base, id: cityId, ownerId: null, applicantKey: null, status: "Issued", submittedAt: now,
      sourceUrl: "https://data.sanjoseca.gov/dataset/last-30-days-building-permits",
      sourceDataset: "City permit data", sourceDate: now, sourceImportedAt: now, synthetic: false,
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
  app.use(apiErrorHandler);
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await db.delete(applicationDocumentAuditTable).where(inArray(applicationDocumentAuditTable.applicationId, applicationIds));
  await db.delete(applicationDocumentsTable).where(inArray(applicationDocumentsTable.applicationId, applicationIds));
  await db.delete(statusHistoryTable).where(inArray(statusHistoryTable.applicationId, applicationIds));
  await db.delete(applicationsTable).where(inArray(applicationsTable.id, applicationIds));
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
  await pool.end();
});

test("document upload and listing are restricted to the application owner", async () => {
  assert.equal((await request("GET", `/applications/${draftId}/documents`)).status, 401);
  assert.equal((await upload("stranger")).response.status, 404);
  assert.equal((await upload("owner", otherDraftId)).response.status, 404);
  assert.equal((await request("GET", `/applications/${otherDraftId}/documents`, "owner")).status, 403);
  assert.equal((await upload("owner", submittedId)).response.status, 404, "wrong owners cannot distinguish a submitted application");
  assert.equal((await upload("submitter", submittedId)).response.status, 403, "the true owner cannot modify a submitted application");
  assert.equal((await upload("owner", cityId)).response.status, 404);

  const reserved = await upload("owner");
  assert.equal(reserved.response.status, 201);
  assert.deepEqual(Object.keys(reserved.body).sort(), ["document", "uploadUrl"]);
  assert.deepEqual(Object.keys(reserved.body.document).sort(), ["contentType", "id", "name", "size", "state", "uploadedAt"]);
  assert.equal(reserved.body.document.state, "pending");
  assert.equal(reserved.body.document.uploadedAt, null);
  assert.equal(reserved.body.document.name, "supporting.pdf");
  const pendingList = await request("GET", `/applications/${draftId}/documents`, "owner");
  assert.equal(pendingList.status, 200);
  assert.equal((await pendingList.json())[0].state, "pending");
  assert.equal((await request("DELETE", `/applications/${draftId}/documents/${reserved.body.document.id}`, "owner")).status, 204);
  assert.equal(globalThis.__applicationDocumentStorageMock.objects.size, 0);
});

test("a valid upload is verified, listed, streamed, and removed through protected routes", async () => {
  const reserved = await upload("owner");
  stageUpload();
  const complete = await request(
    "POST", `/applications/${draftId}/documents/${reserved.body.document.id}/complete`, "owner",
  );
  assert.equal(complete.status, 200);
  const ready = await complete.json();
  assert.equal(ready.id, reserved.body.document.id);
  assert.equal(ready.size, 9);
  assert.equal(ready.state, "ready");
  assert.ok(ready.uploadedAt);
  const immutableResponse = await request(
    "POST", `/applications/${draftId}/documents/${ready.id}/complete`, "owner",
  );
  assert.equal(immutableResponse.status, 200, "lost completion responses are idempotent");
  assert.deepEqual(await immutableResponse.json(), ready);
  stageUpload({ signature: Buffer.from("%PDF-overwrite"), size: 14 });

  const listed = await request("GET", `/applications/${draftId}/documents`, "owner");
  assert.equal(listed.status, 200);
  const documents = await listed.json();
  assert.equal(documents.length, 1);
  assert.equal(documents[0].id, ready.id);
  assert.doesNotMatch(JSON.stringify(documents), /objectId|objectPath|private/);

  const content = await request("GET", `/applications/${draftId}/documents/${ready.id}/content`, "owner");
  assert.equal(content.status, 200);
  assert.match(content.headers.get("content-disposition"), /^inline;/);
  assert.equal(content.headers.get("cache-control"), "no-store");
  assert.equal(Buffer.from(await content.arrayBuffer()).toString(), "%PDF-1.7\n");

  const historyResponse = await request("GET", `/applications/${draftId}/history`, "owner");
  assert.equal(historyResponse.status, 200);
  assert.ok((await historyResponse.json()).some(event => event.status.includes("Document upload completed")),
    "the completed upload is represented in application history");

  assert.equal((await request("DELETE", `/applications/${draftId}/documents/${ready.id}`, "owner")).status, 204);
  assert.equal(globalThis.__applicationDocumentStorageMock.objects.size, 0);
  assert.equal((await request("GET", `/applications/${draftId}/documents`, "owner")).status, 200);
  const audit = await db.select().from(applicationDocumentAuditTable)
    .where(eq(applicationDocumentAuditTable.documentId, ready.id));
  assert.deepEqual(new Set(audit.map(event => event.action)), new Set([
    "upload-reserved", "upload-completed", "content-read", "deleted",
  ]));
  const listAudit = await db.select().from(applicationDocumentAuditTable).where(and(
    eq(applicationDocumentAuditTable.applicationId, draftId),
    eq(applicationDocumentAuditTable.action, "list"),
  ));
  assert.ok(listAudit.length > 0, "list audits are application-scoped rather than document-specific");
});

test("completion rejects mismatched size, content type, and file signature", async () => {
  const cases = [
    { size: 8, contentType: "application/pdf", signature: Buffer.from("%PDF-1.7\n") },
    { size: 9, contentType: "image/png", signature: Buffer.from("%PDF-1.7\n") },
    { size: 9, contentType: "application/pdf", signature: Buffer.from("not a pdf") },
  ];
  for (const badUpload of cases) {
    const reserved = await upload("owner");
    assert.equal(reserved.response.status, 201);
    stageUpload(badUpload);
    const complete = await request(
      "POST", `/applications/${draftId}/documents/${reserved.body.document.id}/complete`, "owner",
    );
    assert.equal(complete.status, 400);
    assert.match((await complete.json()).error, /size, content type, or file signature/);
    assert.equal(globalThis.__applicationDocumentStorageMock.objects.size, 0);
  }
});

test("canceled uploads retain tombstones through signed-link expiry and remove a replay afterward", async () => {
  const reserved = await upload("owner");
  stageUpload();
  const [pending] = await db.select().from(applicationDocumentsTable)
    .where(eq(applicationDocumentsTable.id, reserved.body.document.id));
  assert.ok(pending.uploadUrlExpiresAt > new Date());
  assert.ok(pending.uploadUrlExpiresAt < pending.uploadExpiresAt);

  assert.equal((await request("DELETE", `/applications/${draftId}/documents/${pending.id}`, "owner")).status, 204);
  const [tombstone] = await db.select().from(applicationDocumentsTable)
    .where(eq(applicationDocumentsTable.id, pending.id));
  assert.equal(tombstone.state, "deleting");
  assert.ok(tombstone.stagingCleanedAt);
  const initialDeletes = globalThis.__applicationDocumentStorageMock.deleteStagingCalls.get(pending.stagingObjectId);
  assert.equal(initialDeletes, 1);

  stageUpload({ stagingObjectId: pending.stagingObjectId, signature: Buffer.from("%PDF-replayed") });
  const beforeExpiry = await request("GET", `/applications/${draftId}/documents`, "owner");
  assert.equal(beforeExpiry.status, 200);
  assert.deepEqual(await beforeExpiry.json(), []);
  assert.ok(globalThis.__applicationDocumentStorageMock.objects.has(pending.stagingObjectId),
    "cleanup must retain the tombstone but not repeat before the signed link's safe expiry");
  assert.equal(globalThis.__applicationDocumentStorageMock.deleteStagingCalls.get(pending.stagingObjectId), initialDeletes);
  assert.equal((await db.select().from(applicationDocumentsTable)
    .where(eq(applicationDocumentsTable.id, pending.id))).length, 1);

  await db.update(applicationDocumentsTable).set({
    uploadUrlExpiresAt: new Date(Date.now() - 30 * 60_000),
    stagingCleanedAt: new Date(Date.now() - 60 * 60_000),
  }).where(eq(applicationDocumentsTable.id, pending.id));
  const afterExpiry = await request("GET", `/applications/${draftId}/documents`, "owner");
  assert.equal(afterExpiry.status, 200);
  assert.equal(globalThis.__applicationDocumentStorageMock.objects.has(pending.stagingObjectId), false,
    "cleanup removes staging data recreated after cancellation once link expiry plus grace has passed");
  assert.equal(globalThis.__applicationDocumentStorageMock.deleteStagingCalls.get(pending.stagingObjectId), initialDeletes + 1);
  assert.equal((await db.select().from(applicationDocumentsTable)
    .where(eq(applicationDocumentsTable.id, pending.id))).length, 0);
});

test("submitted documents are readable only by their owner or approved city staff", async () => {
  const reserved = await upload("submitter", submittedId);
  assert.equal(reserved.response.status, 403, "submitted owners cannot change documents");

  const seeded = await db.insert(applicationDocumentsTable).values({
    id: randomUUID(), applicationId: submittedId, name: "review.pdf", size: 9,
    contentType: "application/pdf", stagingObjectId: randomUUID(),
    finalObjectId: randomUUID(), finalGeneration: "fixture-generation", state: "ready",
    uploadExpiresAt: new Date(Date.now() + 86_400_000),
    uploadUrlExpiresAt: new Date(Date.now() + 15 * 60_000), stagingCleanedAt: new Date(),
    uploadedAt: new Date(),
  }).returning();
  const doc = seeded[0];
  const mock = globalThis.__applicationDocumentStorageMock;
  mock.objects.set(doc.finalObjectId, {
    stagingVersions: new Map(), nextGeneration: 0,
    final: {
      size: 9, contentType: "application/pdf", signature: Buffer.from("%PDF-1.7\n"),
      bytes: Buffer.from("%PDF-1.7\n"), generation: doc.finalGeneration, documentId: doc.id,
    },
  });

  assert.equal((await request("GET", `/applications/${submittedId}/documents`, "stranger")).status, 403);
  const crossDepartmentStaff = await request("GET", `/applications/${submittedId}/documents`, "fire");
  assert.equal(crossDepartmentStaff.status, 200);
  assert.equal((await crossDepartmentStaff.json()).length, 1);
  assert.equal((await request("GET", `/applications/${submittedId}/documents`, "unassigned")).status, 403);
  const assigned = await request("GET", `/applications/${submittedId}/documents`, "building");
  assert.equal(assigned.status, 200);
  assert.equal((await assigned.json()).length, 1);
  const economic = await request("GET", `/applications/${submittedId}/documents`, "economic");
  assert.equal(economic.status, 200, "Economic Development master has access across departments");

  const hiddenCity = await request("GET", `/applications/${cityId}/documents`, "economic");
  assert.equal(hiddenCity.status, 404, "public City rows never expose application documents");
  const crossDepartmentContent = await request("GET", `/applications/${submittedId}/documents/${doc.id}/content`, "fire");
  assert.equal(crossDepartmentContent.status, 200);
  assert.equal(Buffer.from(await crossDepartmentContent.arrayBuffer()).toString(), "%PDF-1.7\n");
  const content = await request("GET", `/applications/${submittedId}/documents/${doc.id}/content?download=1`, "building");
  assert.equal(content.status, 200);
  assert.equal(content.headers.get("cache-control"), "no-store");
  assert.equal(content.headers.get("x-content-type-options"), "nosniff");
  assert.match(content.headers.get("content-disposition"), /^attachment;/);
  assert.equal(Buffer.from(await content.arrayBuffer()).toString(), "%PDF-1.7\n");
  assert.equal((await request("GET", "/storage/objects/private/path", "anonymous")).status, 404);
});

test("upload input enforces documented metadata constraints", async () => {
  for (const body of [
    { name: "", size: 1, contentType: "application/pdf" },
    { name: "x".repeat(201), size: 1, contentType: "application/pdf" },
    { name: "a.pdf", size: 0, contentType: "application/pdf" },
    { name: "a.pdf", size: 10_485_761, contentType: "application/pdf" },
    { name: "a.txt", size: 1, contentType: "text/plain" },
  ]) {
    assert.equal((await request("POST", `/applications/${draftId}/documents/upload-url`, "owner", body)).status, 400);
  }
});

test("expired upload reservations do not consume the 20-document limit", async () => {
  const now = new Date();
  const rows = Array.from({ length: 19 }, () => ({
    id: randomUUID(), applicationId: capId, name: "ready.pdf", size: 9,
    contentType: "application/pdf", stagingObjectId: randomUUID(), finalObjectId: randomUUID(),
    finalGeneration: "fixture-generation", state: "ready",
    uploadExpiresAt: new Date(now.getTime() + 86_400_000),
    uploadUrlExpiresAt: new Date(now.getTime() + 15 * 60_000), stagingCleanedAt: now, uploadedAt: now,
  }));
  const expiredId = randomUUID();
  rows.push({
    id: expiredId, applicationId: capId, name: "expired.pdf", size: 9,
    contentType: "application/pdf", stagingObjectId: randomUUID(), finalObjectId: randomUUID(),
    finalGeneration: null, state: "pending", uploadExpiresAt: new Date(now.getTime() - 1_000),
    uploadUrlExpiresAt: new Date(now.getTime() - 60 * 60_000), stagingCleanedAt: null, uploadedAt: null,
  });
  await db.insert(applicationDocumentsTable).values(rows);

  const allowed = await upload("owner", capId);
  assert.equal(allowed.response.status, 201);
  const expired = await db.select().from(applicationDocumentsTable)
    .where(eq(applicationDocumentsTable.id, expiredId));
  assert.equal(expired.length, 0, "expired reservations are tombstoned and cleaned before counting");

  const rejected = await upload("owner", capId);
  assert.equal(rejected.response.status, 400);
  assert.match(rejected.body.error, /at most 20 documents/);
});

test("pending uploads block submission, can be canceled, and stale contact saves cannot undo it", async () => {
  const reserved = await upload("owner", raceId);
  assert.equal(reserved.response.status, 201);
  const [before] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, raceId));
  const submitBody = {
    applicantKey: "race-key",
    plan: planFor("Draft — Requires Review", { applicantEmail: "owner@example.test" }),
    expectedUpdatedAt: before.updatedAt.toISOString(),
  };
  const blocked = await request("PATCH", `/applications/${raceId}`, "owner", submitBody);
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /pending document uploads/);
  assert.equal((await request("DELETE", `/applications/${raceId}/documents/${reserved.body.document.id}`, "owner")).status, 204);

  const submitted = await request("PATCH", `/applications/${raceId}`, "owner", submitBody);
  assert.equal(submitted.status, 200);
  const persisted = await submitted.json();
  assert.equal(persisted.status, "Draft — Requires Review");
  assert.ok(persisted.submittedAt);

  const staleContactSave = await request("PATCH", `/applications/${raceId}`, "owner", {
    ...submitBody,
    plan: planFor("Draft", { applicantEmail: "stale@example.test" }),
  });
  assert.equal(staleContactSave.status, 409);
  const [after] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, raceId));
  assert.equal(after.status, "Draft — Requires Review");
  assert.equal(after.plan.intake.applicantEmail, "owner@example.test");
});

test("an applicant update rechecks status after waiting for the application row lock", async () => {
  const [before] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, lockedRaceId));
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    await client.query("SELECT id FROM permit_applications WHERE id = $1 FOR UPDATE", [lockedRaceId]);
    let resolved = false;
    const pendingRequest = request("PATCH", `/applications/${lockedRaceId}`, "owner", {
      applicantKey: "locked-race-key",
      plan: planFor("Draft", { applicantEmail: "stale@example.test" }),
      expectedUpdatedAt: before.updatedAt.toISOString(),
    }).then(response => { resolved = true; return response; });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(resolved, false, "the route must wait for the application row lock");
    await client.query(
      `UPDATE permit_applications
       SET status = 'Draft — Requires Review', submitted_at = now(), updated_at = now(),
           plan = jsonb_set(plan, '{intake,applicantEmail}', '"winner@example.test"'::jsonb, true)
       WHERE id = $1`,
      [lockedRaceId],
    );
    await client.query("COMMIT");
    const response = await pendingRequest;
    assert.equal(response.status, 409);
    const [after] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, lockedRaceId));
    assert.equal(after.status, "Draft — Requires Review");
    assert.equal(after.plan.intake.applicantEmail, "winner@example.test");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

test("reservation expiry serializes behind an in-flight promotion and cannot tombstone a ready document", async () => {
  const reserved = await upload("owner", expiryRaceId);
  stageUpload();
  const documentId = reserved.body.document.id;
  await db.update(applicationDocumentsTable).set({
    uploadExpiresAt: new Date(Date.now() + 1_000),
  }).where(eq(applicationDocumentsTable.id, documentId));

  let started;
  const promoteStarted = new Promise(resolve => { started = resolve; });
  let release;
  const promoteGate = new Promise(resolve => { release = resolve; });
  const mock = globalThis.__applicationDocumentStorageMock;
  mock.promoteHook = async () => {
    started();
    await promoteGate;
  };
  const completing = request("POST", `/applications/${expiryRaceId}/documents/${documentId}/complete`, "owner");
  try {
    await promoteStarted;
    await new Promise(resolve => setTimeout(resolve, 1_050));
    let cleanupResolved = false;
    const cleanup = request("GET", `/applications/${expiryRaceId}/documents`, "owner")
      .then(response => { cleanupResolved = true; return response; });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(cleanupResolved, false, "expiry cleanup must wait on the same application lock as promotion");
    release();

    const [completeResponse, cleanupResponse] = await Promise.all([completing, cleanup]);
    assert.equal(completeResponse.status, 200);
    assert.equal((await completeResponse.json()).state, "ready");
    assert.equal(cleanupResponse.status, 200);
    assert.deepEqual((await cleanupResponse.json()).map(document => document.id), [documentId]);
    const [persisted] = await db.select().from(applicationDocumentsTable)
      .where(eq(applicationDocumentsTable.id, documentId));
    assert.equal(persisted.state, "ready");
  } finally {
    release();
    mock.promoteHook = null;
  }
});

test("reservation expiry that wins after inspection tombstones before completion can promote", async () => {
  const reserved = await upload("owner", expiryWinsId);
  stageUpload();
  const documentId = reserved.body.document.id;
  await db.update(applicationDocumentsTable).set({
    uploadExpiresAt: new Date(Date.now() + 2_000),
  }).where(eq(applicationDocumentsTable.id, documentId));

  let inspected;
  const inspectionStarted = new Promise(resolve => { inspected = resolve; });
  let release;
  const inspectionGate = new Promise(resolve => { release = resolve; });
  const mock = globalThis.__applicationDocumentStorageMock;
  mock.inspectHook = async () => {
    inspected();
    await inspectionGate;
  };
  const completing = request("POST", `/applications/${expiryWinsId}/documents/${documentId}/complete`, "owner");
  try {
    await inspectionStarted;
    await new Promise(resolve => setTimeout(resolve, 2_050));
    const expiration = await request("GET", `/applications/${expiryWinsId}/documents`, "owner");
    assert.equal(expiration.status, 200);
    assert.deepEqual(await expiration.json(), []);
    release();

    const completeResponse = await completing;
    assert.equal(completeResponse.status, 410, "completion reports expiry rather than treating its old pending snapshot as ready");
    const [persisted] = await db.select().from(applicationDocumentsTable)
      .where(eq(applicationDocumentsTable.id, documentId));
    assert.equal(persisted.state, "deleting");
    assert.equal(mock.objects.has(persisted.finalObjectId), false, "expiration won before final promotion");
  } finally {
    release();
    mock.inspectHook = null;
  }
});

test("simultaneous staff reviews serialize and reject stale decisions", async () => {
  const [before] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, submittedId));
  const expectedUpdatedAt = before.updatedAt.toISOString();
  const decisions = await Promise.all([
    request("PATCH", `/applications/${submittedId}/review`, "building", {
      plan: { status: "Approved", overrides: { decision: "approve" } }, expectedUpdatedAt,
    }),
    request("PATCH", `/applications/${submittedId}/review`, "building", {
      plan: { status: "Rejected", rejected: ["Incomplete documents"] }, expectedUpdatedAt,
    }),
  ]);
  assert.deepEqual(decisions.map(response => response.status).sort(), [200, 409]);
  const [after] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, submittedId));
  assert.ok(["Approved", "Rejected"].includes(after.status));
  const history = await db.select().from(statusHistoryTable).where(eq(statusHistoryTable.applicationId, submittedId));
  assert.equal(history.length, 1, "only the winning locked review writes history");
});

test("document audit failures roll back metadata and defer object cleanup until commit", async () => {
  const storageObjectsBefore = globalThis.__applicationDocumentStorageMock.objects.size;
  const reserved = await upload("owner");
  stageUpload();
  const documentId = reserved.body.document.id;
  const triggerName = `reject_document_audit_${randomUUID().replaceAll("-", "")}`;
  const functionName = `reject_document_audit_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`
    CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'controlled document audit failure';
    END;
    $$;
  `);
  await pool.query(`
    CREATE TRIGGER ${triggerName} BEFORE INSERT ON public.application_document_audit
    FOR EACH ROW WHEN (NEW.document_id = '${documentId}' AND NEW.action = 'upload-completed')
    EXECUTE FUNCTION public.${functionName}();
  `);
  try {
    const failed = await request("POST", `/applications/${draftId}/documents/${documentId}/complete`, "owner");
    assert.equal(failed.status, 500);
    const [pending] = await db.select().from(applicationDocumentsTable).where(eq(applicationDocumentsTable.id, documentId));
    assert.equal(pending.state, "pending");
    assert.equal(pending.finalGeneration, null);
    const finalObject = globalThis.__applicationDocumentStorageMock.objects.get(pending.finalObjectId);
    assert.ok(finalObject?.final, "promotion before the failed DB commit remains an unreachable retryable orphan");
  } finally {
    await pool.query(`DROP TRIGGER ${triggerName} ON public.application_document_audit`);
    await pool.query(`DROP FUNCTION public.${functionName}()`);
  }

  const retried = await request("POST", `/applications/${draftId}/documents/${documentId}/complete`, "owner");
  assert.equal(retried.status, 200, "the same source generation can be promoted idempotently after audit recovery");
  const ready = await retried.json();

  const deleteTriggerName = `reject_document_delete_${randomUUID().replaceAll("-", "")}`;
  const deleteFunctionName = `reject_document_delete_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`
    CREATE FUNCTION public.${deleteFunctionName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'controlled delete audit failure';
    END;
    $$;
  `);
  await pool.query(`
    CREATE TRIGGER ${deleteTriggerName} BEFORE INSERT ON public.application_document_audit
    FOR EACH ROW WHEN (NEW.document_id = '${documentId}' AND NEW.action = 'deleted')
    EXECUTE FUNCTION public.${deleteFunctionName}();
  `);
  try {
    assert.equal((await request("DELETE", `/applications/${draftId}/documents/${documentId}`, "owner")).status, 500);
    const [stillReady] = await db.select().from(applicationDocumentsTable).where(eq(applicationDocumentsTable.id, documentId));
    assert.equal(stillReady.state, "ready");
    assert.ok(globalThis.__applicationDocumentStorageMock.objects.get(stillReady.finalObjectId)?.final,
      "storage objects remain intact when the tombstone/audit transaction rolls back");
  } finally {
    await pool.query(`DROP TRIGGER ${deleteTriggerName} ON public.application_document_audit`);
    await pool.query(`DROP FUNCTION public.${deleteFunctionName}()`);
  }
  assert.equal((await request("DELETE", `/applications/${draftId}/documents/${ready.id}`, "owner")).status, 204);
  assert.equal(globalThis.__applicationDocumentStorageMock.objects.size, storageObjectsBefore,
    "the delete only cleans its own staging/final objects");
});