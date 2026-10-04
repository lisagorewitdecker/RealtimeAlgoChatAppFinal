/**
 * Remembers the last alert the health monitor raised, so its
 * one-alert-per-cooldown rule survives a restart. The cooldown used to live
 * only in process memory, which meant a standing configuration fault filed a
 * fresh Sentry issue every time the server came back up — a crash loop or a
 * rolling restart would bury real alerts in copies of the same one.
 *
 * One row per alert `scope`; the row is overwritten when the alert is raised
 * again and deleted once the fault clears, so the table never grows.
 */
export declare const healthAlertStateTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "health_alert_state";
    schema: undefined;
    columns: {
        scope: import("drizzle-orm/pg-core").PgColumn<{
            name: "scope";
            tableName: "health_alert_state";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: true;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        fingerprint: import("drizzle-orm/pg-core").PgColumn<{
            name: "fingerprint";
            tableName: "health_alert_state";
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
        alertedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "alerted_at";
            tableName: "health_alert_state";
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
export type HealthAlertState = typeof healthAlertStateTable.$inferSelect;
//# sourceMappingURL=healthAlerts.d.ts.map