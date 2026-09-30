import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import esbuild from "esbuild";
import express from "express";
import { and, eq } from "drizzle-orm";
import { db, pool, workspaceConversationsTable, workspaceMessagesTable } from "@workspace/db";

// Exercise the real route, access checks, response schemas, and PostgreSQL.
// Replace only Clerk's network boundary; never allow a client-provided role
// to stand in for the server-side private metadata check in production.
if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_URL) {
  throw new Error("This suite requires NODE_ENV=test and a development test DATABASE_URL.");
}

const fixture = randomUUID();
const conversationId = fixture;
const ticketId = randomUUID();
const ordinaryId = randomUUID();
const originalTime = new Date("2024-01-02T03:04:05.000Z");
let outputDir;
let server;
let baseUrl;

async function request(method, route, actor = "anonymous", body) {
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers: { "x-test-actor": actor, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
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
    { id: ordinaryId, conversationId, role: "assistant", content: "Regular guidance", status: "complete" },
  ]);
  const app = express();
  app.use((req, _res, next) => { req.log = { info() {}, warn() {} }; next(); });
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await db.delete(workspaceMessagesTable).where(eq(workspaceMessagesTable.conversationId, conversationId));
  await db.delete(workspaceConversationsTable).where(eq(workspaceConversationsTable.id, conversationId));
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
  await pool.end();
});

test("queue and acknowledgement reject anonymous, resident, and non-queue staff", async () => {
  for (const [actor, expected] of [["anonymous", 401], ["resident", 403], ["unassigned", 403], ["building", 403]]) {
    assert.equal((await queue(actor)).status, expected, `${actor} queue`);
    assert.equal((await ack(actor)).status, expected, `${actor} acknowledgement`);
  }
  const [row] = await db.select().from(workspaceMessagesTable).where(eq(workspaceMessagesTable.id, ticketId));
  assert.equal(row.status, "high-urgency");
  assert.equal(row.updatedAt.toISOString(), originalTime.toISOString());
});

test("authorized queue lists only urgent tickets without resident details or dispatch promises", async () => {
  for (const actor of ["fire", "economic"]) {
    const response = await queue(actor);
    assert.equal(response.status, 200);
    const item = response.body.find(row => row.ticketId === ticketId);
    assert.ok(item);
    assert.equal(response.body.some(row => row.ticketId === ordinaryId), false);
    assert.equal(item.status, "Awaiting prototype staff acknowledgement");
    assert.equal(item.acknowledgedAt, null);
    assert.match(item.deliveryStatus, /not verified; no automatic dispatch or retries/i);
    assert.doesNotMatch(JSON.stringify(item), /ownerId|conversationId|Prototype safety warning/i);
  }
  assert.equal((await ack("fire", ordinaryId)).status, 404);
  assert.equal((await ack("fire", randomUUID())).status, 404);
  assert.equal((await ack("fire", "bad-id")).status, 400);
});

test("simultaneous staff acknowledgements make one durable state transition", async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    ack(index % 2 ? "fire" : "economic")));
  assert.ok(results.every(result => result.status === 200), JSON.stringify(results));
  const timestamps = results.map(result => result.body.acknowledgedAt);
  assert.ok(timestamps[0]);
  assert.equal(new Set(timestamps).size, 1, "all requests return the original winning acknowledgement");
  assert.ok(new Date(timestamps[0]) > originalTime);
  assert.ok(results.every(result => result.body.status === "Acknowledged in prototype queue"));

  const repeated = await ack("fire");
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.acknowledgedAt, timestamps[0]);
  const [persisted] = await db.select().from(workspaceMessagesTable)
    .where(and(eq(workspaceMessagesTable.id, ticketId), eq(workspaceMessagesTable.status, "high-urgency-acknowledged")));
  assert.ok(persisted);
  assert.equal(persisted.updatedAt.toISOString(), timestamps[0]);
  const reloaded = await queue("economic");
  assert.equal(reloaded.body.find(row => row.ticketId === ticketId).acknowledgedAt, timestamps[0]);
  assert.equal((await ack("resident")).status, 403, "resident cannot change an acknowledged ticket");
});

test("hazardous resident message creates a ticket but never claims delivery or staff action", async () => {
  const sent = await request("POST", `/workspace/conversations/${conversationId}/messages`, "resident", {
    content: "There is a gas leak near my shop",
  });
  assert.equal(sent.status, 201);
  const [saved] = await db.select().from(workspaceMessagesTable).where(eq(workspaceMessagesTable.id, sent.body.message.id));
  assert.equal(saved.status, "high-urgency");
  assert.match(sent.body.message.content, /leave the area and contact emergency services/i);
  assert.match(sent.body.message.content, /has not notified emergency responders or City staff/i);
  assert.match(sent.body.escalation, /No email delivery or City dispatch confirmed/i);
  assert.doesNotMatch(sent.body.message.content, /staff (has|have) acknowledged|email (was|has been) sent/i);
  const newTicket = sent.body.message.id;
  const staffQueue = await queue("fire");
  assert.equal(staffQueue.body.find(row => row.ticketId === newTicket)?.status, "Awaiting prototype staff acknowledgement");
  assert.equal(staffQueue.body.find(row => row.ticketId === newTicket)?.acknowledgedAt, null);

  const messages = await request("GET", `/workspace/conversations/${conversationId}/messages`, "resident");
  assert.equal(messages.status, 200);
  const residentAnswer = messages.body.find(row => row.id === newTicket);
  assert.equal(residentAnswer.content, sent.body.message.content);
  assert.equal((await ack("economic", newTicket)).status, 200);
  const reloaded = await request("GET", `/workspace/conversations/${conversationId}/messages`, "resident");
  assert.equal(reloaded.body.find(row => row.id === newTicket).content, residentAnswer.content,
    "internal acknowledgement does not silently alter the resident-facing warning");
  assert.equal((await request("GET", `/workspace/conversations/${conversationId}/messages`, "fire")).status, 404);
});