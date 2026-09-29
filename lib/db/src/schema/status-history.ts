import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { applicationsTable } from "./applications";

export const statusHistoryTable = pgTable("permit_status_history", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull().references(() => applicationsTable.id),
  status: text("status").notNull(),
  actor: text("actor").notNull(),
  synthetic: boolean("is_synthetic").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});