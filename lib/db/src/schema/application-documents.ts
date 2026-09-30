import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const applicationDocumentsTable = pgTable("application_documents", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull(),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  contentType: text("content_type").notNull(),
  stagingObjectId: text("staging_object_id").notNull().unique(),
  finalObjectId: text("final_object_id").notNull().unique(),
  finalGeneration: text("final_generation"),
  state: text("state").notNull().default("pending"),
  uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }).notNull(),
  uploadUrlExpiresAt: timestamp("upload_url_expires_at", { withTimezone: true }).notNull(),
  stagingCleanedAt: timestamp("staging_cleaned_at", { withTimezone: true }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertApplicationDocumentSchema = createInsertSchema(applicationDocumentsTable);
export type InsertApplicationDocument = z.infer<typeof insertApplicationDocumentSchema>;
export type ApplicationDocument = typeof applicationDocumentsTable.$inferSelect;

export const applicationDocumentAuditTable = pgTable("application_document_audit", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull(),
  documentId: text("document_id"),
  actorId: text("actor_id").notNull(),
  actorDepartment: text("actor_department"),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});