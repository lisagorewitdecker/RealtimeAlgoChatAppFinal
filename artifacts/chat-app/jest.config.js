const expoPreset = require("jest-expo/jest-preset");

// jest-expo ignores node_modules for transforms except for an allowlist of
// packages that ship untranspiled source. The module contract tests
// (test-support/tabLayoutModuleContract.ts and
// test-support/screenModuleContract.ts, each run once per platform)
// import the app's native packages for real (no jest.mock) so an SDK upgrade
// cannot quietly drop an export a screen needs, and expo-router reaches
// decode-uri-component, an ESM-only transitive dependency Jest cannot parse
// without Babel. Extend the preset's allowlist instead of restating it, so
// packages jest-expo adds later still apply.
const esmOnlyDependencies = ["decode-uri-component"];
const allowlistPrefix = "/node_modules/(?!(";

const transformIgnorePatterns = expoPreset.transformIgnorePatterns.map(
  (pattern) =>
    pattern.startsWith(allowlistPrefix)
      ? allowlistPrefix +
        esmOnlyDependencies.join("|") +
        "|" +
        pattern.slice(allowlistPrefix.length)
      : pattern,
);

// Everything a suite needs regardless of the platform it runs on.
const sharedProjectConfig = {
  rootDir: __dirname,
  // Chains the Worklets resolver onto the preset's React Native one so the
  // contract test can import react-native-keyboard-controller for real; see
  // test-support/jestResolver.js.
  resolver: "<rootDir>/test-support/jestResolver.js",
  setupFiles: ["<rootDir>/jest.setup.js"],
  // These run once the test framework exists, so unlike the files above they
  // can register hooks: jest.setup.after-env.js gives every suite its real
  // timers back between tests, so one test freezing the clock cannot strand
  // the test after it. The file explains what a run does without it.
  setupFilesAfterEnv: ["<rootDir>/jest.setup.after-env.js"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transformIgnorePatterns,
};

// A jest run resolves modules and transforms sources for one platform, so a
// suite can only measure the platform its project targets. Almost everything
// here is platform-independent and runs once on jest-expo's default platform
// (iOS); the files matched by the android and web projects below measure what
// React Navigation and the Expo SDK build for those platforms, which no iOS
// run can see. The app ships all three — the browser build is what the Replit
// preview serves and what server/serve.js hands out — and several of these
// packages resolve different sources there, so an SDK bump that renamed or
// dropped a web export has to fail here rather than in the browser. Each of
// these files is a thin entry point over a suite in test-support/ that the iOS
// run drives too, and each asserts the platform it is running on, so a change
// here cannot quietly downgrade one run into a copy of another.
const androidTestMatch = ["<rootDir>/__tests__/**/*.test.android.[jt]s?(x)"];
const webTestMatch = ["<rootDir>/__tests__/**/*.test.web.[jt]s?(x)"];

module.exports = {
  maxWorkers: 1,
  projects: [
    {
      ...sharedProjectConfig,
      displayName: "ios",
      preset: "jest-expo",
      // Jest's default patterns match every file under __tests__, including
      // the Android-only and web-only suites the projects below own.
      testPathIgnorePatterns: [
        "/node_modules/",
        "\\.test\\.android\\.[jt]sx?$",
        "\\.test\\.web\\.[jt]sx?$",
      ],
    },
    {
      ...sharedProjectConfig,
      displayName: "android",
      preset: "jest-expo/android",
      // The android preset would otherwise claim the whole suite: it matches
      // plain *.test.tsx files as well as Android-suffixed ones.
      testMatch: androidTestMatch,
    },
    {
      ...sharedProjectConfig,
      displayName: "web",
      // The web preset resolves `.web` sources first, aliases react-native to
      // react-native-web and runs in jsdom — the way Metro builds the browser
      // bundle — which is why jest-environment-jsdom is a dependency of this
      // package.
      preset: "jest-expo/web",
      // The web preset matches plain *.test.tsx files too, so it needs the
      // same narrowing as the android one.
      testMatch: webTestMatch,
      // Jest concatenates the preset's setup files with these, so the shared
      // one still runs; jest.setup.web.js only covers what jsdom is missing.
      setupFiles: [
        ...sharedProjectConfig.setupFiles,
        "<rootDir>/jest.setup.web.js",
      ],
      // The shared setupFilesAfterEnv entry above carries over untouched, and
      // this project is the one that cannot run without it: a router render
      // takes the real timers away here too, and nothing in jsdom puts them
      // back on its own.
      moduleNameMapper: {
        ...sharedProjectConfig.moduleNameMapper,
        // Metro turns a stylesheet import into class names for the browser
        // bundle; Jest has no such transform and would fail to parse the
        // stylesheet expo-router pulls in on web. See
        // test-support/cssModuleStub.js.
        "\\.css$": "<rootDir>/test-support/cssModuleStub.js",
        // The web preset already aliases react-native to react-native-web the
        // way Metro does for the browser, but it appends that entry after the
        // React Native preset's own `^react-native($|/.*)` rule, and Jest
        // takes the first pattern that matches. Restating it here puts it
        // first — jest merges a project's own map ahead of its preset's — so
        // packages reached through node_modules get react-native-web too.
        // Without it @clerk/expo loads the native `react-native` and reads
        // `Platform.OS` off an export that is not there.
        // test-support/screenModuleContract.ts names the build it ended up
        // with on both routes it loads packages by — the plain require the
        // app's own imports compile to, and the jest.requireActual it needs
        // for the one package jest.setup.js mocks — so a run that lost this
        // entry, or a route that stopped honouring it, fails there instead of
        // in the browser.
        "^react-native$": "react-native-web",
      },
    },
  ],
};
