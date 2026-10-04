import { describeTabLayoutModuleContract } from "../test-support/tabLayoutModuleContract";

/**
 * Runs the tab layout's module contract against the packages an Android build
 * of the app resolves.
 *
 * The rest of the suite runs on jest-expo's default platform (iOS), so
 * TabLayoutExports.test.ts only ever inspects the iOS build of expo-router,
 * expo-glass-effect and friends. Those packages ship platform-specific
 * sources, and Android is where the classic tab bar ships in production, so an
 * SDK upgrade that renamed or dropped an Android export would leave that run
 * green while an Android phone crashed on launch with an invalid element type
 * — the exact failure this contract exists to prevent.
 *
 * jest.config.js sends this file to a second project built on
 * `jest-expo/android`: module resolution prefers `.android` sources, sources
 * are transformed for Android, and `Platform.OS` is `android` throughout, so
 * the contract reads what Android actually resolves rather than restating what
 * the iOS run found. test-support/tabLayoutModuleContract.ts holds the suite
 * both entry points share.
 */

describeTabLayoutModuleContract("android");
