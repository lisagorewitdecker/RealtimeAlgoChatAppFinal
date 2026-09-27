import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
export const healthAlertStateTable = pgTable("health_alert_state", {
  /** Which health alert this row belongs to, e.g. "readiness". */
  scope: text("scope").primaryKey(),
  /**
   * The fault's shape, as the alert describes it. A different fingerprint
   * means a different fault, which alerts immediately rather than waiting
   * out the cooldown the previous fault started. Setting name and problem
   * class only — a configured value never reaches here.
   */
  fingerprint: text("fingerprint").notNull(),
  /** When the alert was last raised. */
  alertedAt: timestamp("alerted_at", { withTimezone: true }).notNull(),
});

export type HealthAlertState = typeof healthAlertStateTable.$inferSelect;
