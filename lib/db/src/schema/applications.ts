import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const applicationsTable = pgTable("permit_applications", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id"),
  applicantKey: text("applicant_key"),
  businessName: text("business_name").notNull(),
  businessCategory: text("business_category").notNull(),
  requestType: text("request_type").notNull(),
  status: text("status").notNull(),
  assignedDepartment: text("assigned_department").notNull(),
  applicantLanguage: text("applicant_language").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  description: text("description").notNull(),
  notes: text("notes"),
  synthetic: boolean("synthetic").notNull().default(true),
  sourceUrl: text("source_url"),
  sourceDataset: text("source_dataset"),
  sourceDate: timestamp("source_date", { withTimezone: true }),
  sourceImportedAt: timestamp("source_imported_at", { withTimezone: true }),
  plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertApplicationSchema = createInsertSchema(applicationsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type Application = typeof applicationsTable.$inferSelect;