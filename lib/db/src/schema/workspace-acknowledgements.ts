import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { workspaceMessagesTable } from "./workspace";

// One immutable acknowledgement event per urgent ticket. The ticket key also
// prevents a repeated or concurrent request from creating a second event.
export const workspaceAcknowledgementsTable = pgTable("workspace_acknowledgements", {
  ticketId: text("ticket_id").primaryKey().references(() => workspaceMessagesTable.id),
  staffUserId: text("staff_user_id").notNull(),
  staffDepartment: text("staff_department").notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull(),
});