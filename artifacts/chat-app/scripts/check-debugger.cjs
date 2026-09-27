const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { scripts } = require("../package.json");

const wrapper = "scripts/with-desktop-libraries.sh";
const wrappedExpoStart = `sh ${wrapper} pnpm exec expo start`;

async function main() {
  if (!process.env.REPLIT_LD_LIBRARY_PATH) {
    throw new Error(
      "REPLIT_LD_LIBRARY_PATH is empty. Start this check in the Replit workspace with the Nix desktop libraries from .replit available.",
    );
  }

  if (!scripts.dev.includes(wrappedExpoStart)) {
    throw new Error(
      `The managed Expo dev command must launch expo start through ${wrapper}, or DevTools will not inherit the desktop library path.`,
    );
  }

  if (process.argv[2] !== "--probe") {
    const result = spawnSync("sh", [wrapper, process.execPath, __filename, "--probe"], {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    return;
  }

  const requiredPaths = process.env.REPLIT_LD_LIBRARY_PATH.split(":").filter(Boolean);
  const availablePaths = new Set((process.env.LD_LIBRARY_PATH || "").split(":"));
  if (requiredPaths.some((entry) => !availablePaths.has(entry))) {
    throw new Error(
      "LD_LIBRARY_PATH is missing Replit's desktop library directories. Run the debugger check through the same wrapper as the managed Expo workflow.",
    );
  }

  // Resolve via React Native: debugger-shell is its dependency, not an app dependency.
  const reactNativePackage = require.resolve("react-native/package.json");
  const debuggerShell = require.resolve("@react-native/debugger-shell", {
    paths: [reactNativePackage],
  });
  const { unstable_prepareDebuggerShell } = require(debuggerShell);
  const result = await unstable_prepareDebuggerShell();
  if (result.code !== "success") {
    throw new Error(
      `React Native DevTools could not run its --version check: ${result.verboseInfo || result.code}. Check .replit Nix packages and the managed Expo library path.`,
    );
  }
  console.log("React Native DevTools version check passed with the managed Expo library path.");
}

main().catch((error) => {
  console.error(`Debugger check failed: ${error.message}`);
  process.exitCode = 1;
});