import { db, applicationsTable, statusHistoryTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { createDemoApplications } from "./applicationSamples";

/** Stable IDs and transactional, conflict-safe inserts make this safe on startup and recovery. */
export async function seedDemoApplications() {
  const rows = createDemoApplications();
  await db.transaction(async tx => {
    // Use the same transaction-scoped advisory lock as schema setup so
    // concurrent application replicas cannot interleave seed writes.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(1297304400, 1397834054)`);
    await tx.insert(applicationsTable).values(rows).onConflictDoNothing();
    await tx.insert(statusHistoryTable).values(rows.map(row => ({
      id: `SEED-${row.id}`,
      applicationId: row.id,
      status: row.status,
      actor: "Demo seed",
      synthetic: true,
    }))).onConflictDoNothing();
  });
  logger.info({ records: rows.length }, "Ensured synthetic District 2 demonstration records");
}