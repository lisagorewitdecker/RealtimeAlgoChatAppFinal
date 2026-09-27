/**
 * Jest resolver for the chat app.
 *
 * jest-expo's preset installs React Native's resolver, and
 * test-support/screenModuleContract.ts imports react-native-keyboard-controller
 * for real so an SDK upgrade cannot quietly drop an export the chat screens
 * need. That package pulls in Reanimated and Worklets, and Worklets' *.native
 * source expects a JSI runtime Jest does not have, so its non-native files have
 * to be preferred instead — the same thing react-native-worklets/jest/resolver.js
 * does.
 *
 * That vendored resolver cannot be used directly here: it decides whether a
 * request belongs to Worklets by looking for "react-native-worklets" anywhere in
 * the importing directory, and pnpm writes peer dependencies into store paths,
 * so half the Expo packages live under a directory containing that name and
 * would lose their native files too. The check below matches the package
 * itself, and everything else keeps resolving exactly as React Native intends.
 */
const path = require("path");
const reactNativeResolver = require("@react-native/jest-preset/jest/resolver.js");

const workletsPackageDir = `${path.sep}node_modules${path.sep}react-native-worklets${path.sep}`;

function isWorkletsRequest(request, options) {
  return (
    request === "react-native-worklets" ||
    request.startsWith("react-native-worklets/") ||
    (options.basedir ?? "").includes(workletsPackageDir)
  );
}

module.exports = (request, options) =>
  reactNativeResolver(
    request,
    isWorkletsRequest(request, options)
      ? {
          ...options,
          extensions: options.extensions?.filter(
            (extension) => !extension.includes("native"),
          ),
        }
      : options,
  );
