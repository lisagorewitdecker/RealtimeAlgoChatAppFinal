import { describeScreenModuleContract } from "../test-support/screenModuleContract";

/**
 * Runs the screens' module contract against the packages an Android build of
 * the app resolves.
 *
 * The rest of the suite runs on jest-expo's default platform (iOS), so
 * ScreenModuleExports.test.ts only ever inspects the iOS build of @clerk/expo,
 * react-native-keyboard-controller, react-native-webview and the rest. Several
 * of them ship platform-specific sources, so an SDK upgrade that renamed or
 * dropped an Android export would leave that run green while an Android phone
 * crashed on launch with an invalid element type — the exact failure this
 * contract exists to prevent.
 *
 * jest.config.js sends this file to a second project built on
 * `jest-expo/android`: module resolution prefers `.android` sources, sources
 * are transformed for Android, and `Platform.OS` is `android` throughout, so
 * the contract reads what Android actually resolves rather than restating what
 * the iOS run found. test-support/screenModuleContract.ts holds the suite both
 * entry points share.
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

describeScreenModuleContract("android");
