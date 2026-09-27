import { boolean, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const roomsTable = pgTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});

export type Room = typeof roomsTable.$inferSelect;

export const roomMembersTable = pgTable("room_members", {
  roomId: text("room_id")
    .notNull()
    .references(() => roomsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  role: text("role").default("member").notNull(),
}, (table) => ({
  roomUserPk: primaryKey({
    name: "room_members_room_user_pk",
    columns: [table.roomId, table.userId],
  }),
}));

export type RoomMember = typeof roomMembersTable.$inferSelect;
