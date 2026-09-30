import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  db, applicationsTable, applicationDocumentsTable, applicationDocumentAuditTable,
} from "@workspace/db";
import { applicationDocumentStorage, SIGNED_UPLOAD_IN_FLIGHT_GRACE_MS } from "./applicationDocumentStorage";
import { logger } from "./logger";

type ApplicationDocument = typeof applicationDocumentsTable.$inferSelect;

function safeCleanupAt(document: ApplicationDocument): Date {
  return new Date(document.uploadUrlExpiresAt.getTime() + SIGNED_UPLOAD_IN_FLIGHT_GRACE_MS);
}

function dueForCleanup(document: ApplicationDocument, now: Date): boolean {
  if (document.state === "pending") return document.uploadExpiresAt <= now;
  if (document.state !== "deleting" && document.state !== "ready") return false;
  if (!document.stagingCleanedAt) return true;
  return now >= safeCleanupAt(document) && document.stagingCleanedAt < safeCleanupAt(document);
}

function documentAuditValues(applicationId: string, documentId: string, actorId: string, action: string) {
  return { id: crypto.randomUUID(), applicationId, documentId, actorId, action };
}

async function expirePendingDocument(applicationId: string, documentId: string, now: Date): Promise<ApplicationDocument | null> {
  return db.transaction(async tx => {
    const [application] = await tx.select({ id: applicationsTable.id }).from(applicationsTable)
      .where(eq(applicationsTable.id, applicationId)).for("update");
    if (!application) return null;
    const [current] = await tx.select().from(applicationDocumentsTable).where(and(
      eq(applicationDocumentsTable.id, documentId),
      eq(applicationDocumentsTable.applicationId, applicationId),
    )).for("update");
    if (!current || current.state !== "pending" || current.uploadExpiresAt > now) return null;
    const [tombstone] = await tx.update(applicationDocumentsTable).set({
      state: "deleting", stagingCleanedAt: null,
    }).where(and(
      eq(applicationDocumentsTable.id, current.id),
      eq(applicationDocumentsTable.state, "pending"),
      lte(applicationDocumentsTable.uploadExpiresAt, now),
    )).returning();
    if (!tombstone) return null;
    await tx.insert(applicationDocumentAuditTable).values(documentAuditValues(
      tombstone.applicationId, tombstone.id, "system:document-cleanup", "reservation-expired",
    ));
    return tombstone;
  });
}

export async function cleanupDocumentObject(document: ApplicationDocument): Promise<void> {
  try {
    const now = new Date();
    if (document.state === "deleting") {
      if (document.stagingCleanedAt && now < safeCleanupAt(document)) return;
      await applicationDocumentStorage.deleteStaging(document.stagingObjectId);
      await applicationDocumentStorage.deleteFinal(document.finalObjectId, document.finalGeneration, document.id);
      if (now >= safeCleanupAt(document)) {
        await db.delete(applicationDocumentsTable).where(and(
          eq(applicationDocumentsTable.id, document.id), eq(applicationDocumentsTable.state, "deleting"),
        ));
      } else {
        await db.update(applicationDocumentsTable).set({ stagingCleanedAt: now }).where(and(
          eq(applicationDocumentsTable.id, document.id), eq(applicationDocumentsTable.state, "deleting"),
        ));
      }
    } else if (document.state === "ready" && dueForCleanup(document, now)) {
      await applicationDocumentStorage.deleteStaging(document.stagingObjectId);
      await db.update(applicationDocumentsTable).set({ stagingCleanedAt: now }).where(and(
        eq(applicationDocumentsTable.id, document.id), eq(applicationDocumentsTable.state, "ready"),
      ));
    }
  } catch (error) {
    logger.error({ err: error, documentId: document.id }, "Application document storage cleanup will be retried");
  }
}

export async function cleanupApplicationDocuments(applicationId: string): Promise<void> {
  const now = new Date();
  const documents = await db.select().from(applicationDocumentsTable)
    .where(eq(applicationDocumentsTable.applicationId, applicationId));
  for (const document of documents) {
    if (document.state === "pending" && document.uploadExpiresAt <= now) {
      const tombstone = await expirePendingDocument(applicationId, document.id, now);
      if (tombstone) await cleanupDocumentObject(tombstone);
    } else if (dueForCleanup(document, now)) {
      await cleanupDocumentObject(document);
    }
  }
}

export async function runApplicationDocumentCleanupCycle(): Promise<void> {
  const now = new Date();
  const safeLinkExpiry = new Date(now.getTime() - SIGNED_UPLOAD_IN_FLIGHT_GRACE_MS);
  const cleanupBeforeSafeExpiry = sql`${applicationDocumentsTable.uploadUrlExpiresAt} + ${SIGNED_UPLOAD_IN_FLIGHT_GRACE_MS} * interval '1 millisecond'`;
  const due = await db.select().from(applicationDocumentsTable).where(or(
    and(
      eq(applicationDocumentsTable.state, "pending"),
      lte(applicationDocumentsTable.uploadExpiresAt, now),
    ),
    and(
      eq(applicationDocumentsTable.state, "deleting"),
      or(
        isNull(applicationDocumentsTable.stagingCleanedAt),
        and(
          lte(applicationDocumentsTable.uploadUrlExpiresAt, safeLinkExpiry),
          lte(applicationDocumentsTable.stagingCleanedAt, cleanupBeforeSafeExpiry),
        ),
      ),
    ),
    and(
      eq(applicationDocumentsTable.state, "ready"),
      or(
        isNull(applicationDocumentsTable.stagingCleanedAt),
        and(
          lte(applicationDocumentsTable.uploadUrlExpiresAt, safeLinkExpiry),
          lte(applicationDocumentsTable.stagingCleanedAt, cleanupBeforeSafeExpiry),
        ),
      ),
    ),
  )).limit(200);

  for (const document of due) {
    if (document.state === "pending") {
      const tombstone = await expirePendingDocument(document.applicationId, document.id, now);
      if (tombstone) await cleanupDocumentObject(tombstone);
    } else if (dueForCleanup(document, now)) {
      await cleanupDocumentObject(document);
    }
  }
}

export function scheduleApplicationDocumentCleanup(): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runApplicationDocumentCleanupCycle();
    } catch (error) {
      logger.error({ err: error }, "Application document maintenance cycle failed");
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), 60_000).unref();
}