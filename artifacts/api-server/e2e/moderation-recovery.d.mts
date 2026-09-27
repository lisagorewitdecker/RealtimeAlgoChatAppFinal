import type { createClerkClient } from "@clerk/backend";
export const MIN_AGE_MS: number;
export const MAX_AGE_MS: number;
export type Intent = {
  namespace: string; runId: string; token: string; role: "target" | "non-moderator";
  createdAt: number; email: string; id?: string; verified?: boolean;
};
export function assertDevelopment(env: NodeJS.ProcessEnv): void;
export class RecoveryJournal {
  constructor(directory?: string);
  save(record: Intent): void;
  records(): Intent[];
  remove(record: Intent): void;
}
export function newIntent(runId: string, role: Intent["role"], now?: number): Intent;
export function ownership(record: Intent): Record<string, string | number>;
export function recoverDisposables(options: {
  journal: RecoveryJournal;
  users: ReturnType<typeof createClerkClient>["users"];
  /** Removes every database row this disposable account owns. */
  deleteAccountRows: (id: string) => Promise<unknown>;
  env: NodeJS.ProcessEnv;
  now?: number;
  currentRun?: string;
}): Promise<number>;