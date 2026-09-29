import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const workspaceConversationsTable = pgTable("workspace_conversations", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull().default("New conversation"),
  mode: text("mode").notNull(),
  status: text("status").notNull().default("active"),
  synthetic: boolean("is_synthetic").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMessagesTable = pgTable("workspace_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => workspaceConversationsTable.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("complete"),
  synthetic: boolean("is_synthetic").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});