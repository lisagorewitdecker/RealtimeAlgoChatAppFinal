import { describeTabLayoutModuleContract } from "../test-support/tabLayoutModuleContract";

/**
 * Runs the tab layout's module contract against the packages an iOS build of
 * the app resolves — the platform jest-expo's default project targets, so this
 * is the run that happens with no extra configuration.
 *
 * TabLayoutExports.test.android.ts runs the same contract against the Android
 * builds of those packages, which is where the classic tab bar ships in
 * production. test-support/tabLayoutModuleContract.ts holds the suite both
 * share, and explains which exports are asserted on which platform.
 */

describeTabLayoutModuleContract("ios");
