import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Moderator allow-list managed from the moderation panel, so who moderates
 * can change without editing configuration and publishing again.
 *
 * This table is additive: the ADMIN_USER_IDS environment variable remains
 * the bootstrap list, so an empty table can never lock everyone out of the
 * moderation tools.
 */
export const moderatorsTable = pgTable("moderators", {
  userId: text("user_id").primaryKey(),
  /** The moderator who granted this access, for the audit trail. */
  grantedBy: text("granted_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Moderator = typeof moderatorsTable.$inferSelect;
