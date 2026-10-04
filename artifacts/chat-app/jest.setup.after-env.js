/**
 * Hands every jest project back real timers between tests.
 *
 * A test that installs jest's fake timers owns the clock for every test after
 * it in the same file until something restores the real ones. Those tests then
 * wait on a clock nothing advances and fail five seconds later with a message
 * naming the timer rather than the behaviour they were checking. Restoring the
 * timers here reaches every suite in all three projects, including the next one
 * someone writes, so a suite that freezes the clock does not have to remember
 * to thaw it. A test that wants fake timers still installs them itself — it
 * just cannot leave them installed for the test after it.
 *
 * The web project cannot run at all without this. expo-router's `renderRouter`
 * installs fake timers and never restores them, and the cleanup that follows
 * survives that on the phone projects but not under jsdom:
 * @testing-library/react-native unmounts what a test rendered in an `afterEach`
 * of its own, and lets pending work settle first by awaiting a promise it
 * resolves from `setImmediate`. It binds that function once, as it is imported:
 * node has one, a browser has none, so in jsdom it binds a fallback that reads
 * `setTimeout` off the global when called — and by then the fake timers own it.
 * So every web test that rendered a router fails on that five-second timeout,
 * with a message naming the testing library and saying nothing about the app.
 *
 * This hook runs before that unmount: jest runs the hooks of a block in the
 * order they were registered, this file runs before the test file, and the
 * library registers its cleanup as it is imported from there. A suite's own
 * `afterEach` sits inside its `describe` and so still runs ahead of both, which
 * is what a suite that has to tear something down under the frozen clock needs.
 *
 * Listed once, on the shared project config in jest.config.js.
 */
afterEach(() => {
  jest.useRealTimers();
});
