/**
 * Persists the short window during which a kicked user cannot rejoin a room.
 * A single row per room/user is refreshed when the user is kicked again.
 */
export declare const roomKickCooldownsTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "room_kick_cooldowns";
    schema: undefined;
    columns: {
        roomId: import("drizzle-orm/pg-core").PgColumn<{
            name: "room_id";
            tableName: "room_kick_cooldowns";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        userId: import("drizzle-orm/pg-core").PgColumn<{
            name: "user_id";
            tableName: "room_kick_cooldowns";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        expiresAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "expires_at";
            tableName: "room_kick_cooldowns";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    };
    dialect: "pg";
}>;
export type RoomKickCooldown = typeof roomKickCooldownsTable.$inferSelect;
//# sourceMappingURL=kickCooldowns.d.ts.map