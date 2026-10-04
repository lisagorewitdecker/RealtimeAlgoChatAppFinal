import { describeScreenModuleContract } from "../test-support/screenModuleContract";

/**
 * Runs the screens' module contract against the packages an iOS build of the
 * app resolves — the platform jest-expo's default project targets, so this is
 * the run that happens with no extra configuration.
 *
 * ScreenModuleExports.test.android.ts runs the same contract against the
 * Android builds of those packages.
 * test-support/screenModuleContract.ts holds the suite both share and explains
 * what it guards.
 */

/**
 * Three of the packages the contract imports demand a linked native module the
 * moment they load. test-support/turboModuleRegistryStub.ts answers only those
 * lookups with an inert stub and leaves the rest of the registry real; a
 * jest.mock factory is hoisted above this file's imports, so it has to be
 * reached through jest.requireActual rather than an import binding that would
 * still be uninitialised when the factory first runs.
 */
jest.mock("react-native/Libraries/TurboModule/TurboModuleRegistry", () =>
  jest
    .requireActual<typeof import("../test-support/turboModuleRegistryStub")>(
      "../test-support/turboModuleRegistryStub",
    )
    .registryWithStubbedNativeModules(),
);

describeScreenModuleContract("ios");
