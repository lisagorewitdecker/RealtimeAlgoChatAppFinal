/**
 * The native-module registry the unmocked screen contract runs against.
 *
 * Three of the packages test-support/screenModuleContract.ts imports ask for a
 * linked native module the moment they are imported:
 * react-native-keyboard-controller builds a NativeEventEmitter over
 * KeyboardController, react-native-webview calls getEnforcing for
 * RNCWebViewModule, and AsyncStorage refuses to load without RNCAsyncStorage.
 * Only those lookups are answered with an inert stub — everything else still
 * goes to the real registry — so the packages' own JavaScript, and therefore
 * the exports the contract asserts, stay real.
 *
 * A jest.mock factory is hoisted above its file's imports, so each entry point
 * (__tests__/ScreenModuleExports.test.ts and its .test.android.ts twin) reaches
 * this helper through jest.requireActual inside the factory rather than an
 * import, which would not be initialised yet when the factory first runs.
 */

/** The native modules answered with an inert stub instead of a real lookup. */
const STUBBED_MODULES = new Set([
  "KeyboardController",
  "RNCAsyncStorage",
  "RNCWebViewModule",
]);

export function registryWithStubbedNativeModules() {
  const registry = jest.requireActual<
    typeof import("react-native/Libraries/TurboModule/TurboModuleRegistry")
  >("react-native/Libraries/TurboModule/TurboModuleRegistry");
  const stub = {
    addListener: () => {},
    removeListeners: () => {},
    getConstants: () => ({}),
  };
  return {
    ...registry,
    get: (name: string) =>
      STUBBED_MODULES.has(name) ? stub : registry.get(name),
    getEnforcing: (name: string) =>
      STUBBED_MODULES.has(name) ? stub : registry.getEnforcing(name),
  };
}
