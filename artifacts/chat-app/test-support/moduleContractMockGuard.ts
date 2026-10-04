import { Platform } from "react-native";

import { EVERY_PACKAGE_REAL, mockedPackageReport } from "./moduleContract";

/**
 * The proof that mockedPackageReport still tells a stand-in from the real
 * module, run once per platform.
 *
 * Four suites are only worth running while the packages they read are the real
 * ones: test-support/screenModuleContract.ts and
 * test-support/tabLayoutModuleContract.ts inspect the exports the app's
 * screens and tab bar import, __tests__/FeatherIconNames.test.ts checks the
 * app's icon names against the real Feather glyph map, and
 * test-support/webTabBar.tsx renders the browser's tab bar out of the real
 * packages. Each therefore hands mockedPackageReport the packages it depends
 * on, and none of them can show that check firing: a passing run is the one
 * state with no mock to notice.
 *
 * The check asks a run for a package twice — through `require`, the route an
 * import compiles to and the one jest.mock replaces, and through
 * jest.requireActual, which steps past a mock — and reports a package the two
 * routes answer differently. Both routes are the running jest project's own
 * resolution: the web project prefers `.web` sources and aliases react-native
 * to react-native-web, the android project prefers `.android` ones, and
 * jest.requireActual resolves on its own terms rather than the app's. Whether
 * a mock makes those two answers differ is therefore a property of a project
 * and not of the checking code, so a preset or resolver change that collapsed
 * them on one project would leave every guard there passing over stand-ins,
 * with the other projects' proofs still green.
 *
 * Each entry point installs mocks of its own and hands this suite the packages
 * it replaced and the packages it left alone:
 * __tests__/ModuleContractMockGuard.test.ts on the iOS project, which also
 * pins the check's wording and its one exemption,
 * __tests__/ModuleContractMockGuard.test.android.ts on the android one and
 * __tests__/ModuleContractMockGuard.test.web.ts on the web one.
 */

export type MockedPackageProof = {
  /** The platform the calling file's jest project targets. */
  expectedPlatform: "android" | "ios" | "web";
  /**
   * The packages the calling file replaced with a mock of its own, written the
   * way the app imports them. Each has to be one the suites that rely on this
   * check read for real on this platform, or the proof describes a package
   * nothing here depends on.
   */
  mockedPackages: readonly string[];
  /**
   * The packages that file left alone, which this project resolves for real.
   */
  realPackages: readonly string[];
};

/**
 * Registers the mocked-package check's proof for one platform.
 */
export function describeMockedPackageGuard({
  expectedPlatform,
  mockedPackages,
  realPackages,
}: MockedPackageProof): void {
  describe(`the mocked-package check on ${expectedPlatform}`, () => {
    it("runs on the platform this file exists to measure", () => {
      // Each entry point only shows the check firing on another project while
      // its project in jest.config.js keeps targeting the platform it was
      // written for. A project that quietly stopped doing so would leave two
      // of these files proving the same resolution, and both would pass.
      expect(`the suite is running on ${Platform.OS}`).toBe(
        `the suite is running on ${expectedPlatform}`,
      );
    });

    it("passes the packages this run leaves alone", () => {
      // Both routes reach the same file for a package nothing mocked, and jest
      // caches a module by its resolved path, so the check has to see one
      // object. A run where that stopped holding would fail every suite that
      // calls this check rather than let one through, which is the failure
      // this direction watches for.
      expect(mockedPackageReport(realPackages)).toBe(EVERY_PACKAGE_REAL);
    });

    it.each(mockedPackages)("names %s, which a mock replaced", (specifier) => {
      // Handed in beside the packages this run left alone, so a check that
      // named everything — or nothing — fails here rather than reading as a
      // guard that works.
      expect(mockedPackageReport([...realPackages, specifier])).toBe(
        `${specifier} is a mock, not the real module`,
      );
    });
  });
}
