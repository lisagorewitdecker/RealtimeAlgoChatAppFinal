/**
 * The reading made before the release command's first browser suite starts:
 * every setting the suites it chains declare, named together rather than one
 * suite's worth at a time.
 *
 * The chain is read out of a workspace, so most of these cases build a
 * throwaway one and declare suites for it. Two are about the workspace this
 * runs in: that its release command really does make this reading first, and
 * that the reading covers every suite that command runs.
 */
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
  type BrowserSuite,
  MODERATION_RECOVERY_COMMAND,
  MODERATION_SUITE,
} from "@workspace/browser-test-requirements";
import { RELEASE_SCRIPT, ROOT_DIR } from "../src/checkReleaseSuites.ts";
import {
  declaredSuites,
  RELEASE_SETTINGS_SCRIPT,
  readReleaseSettings,
} from "../src/releaseSettings.ts";

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** The package this workspace's browser suites live in. */
const API = "artifacts/api-server";

/** Where a suite's bare `config` name is read, as the declarations state it. */
const E2E = `${API}/e2e`;

interface PackageSpec {
  name?: string;
  scripts?: Record<string, string>;
  /** Files of that package, by path relative to its directory. */
  files?: Record<string, string>;
}

/** A throwaway workspace on disk, removed when the test ends. */
function workspace(t: TestContext, packages: Record<string, PackageSpec>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-settings-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const write = (relative: string, contents: string): void => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };

  write("pnpm-workspace.yaml", "packages:\n  - artifacts/*\n  - lib/*\n");
  for (const [dir, pkg] of Object.entries(packages)) {
    write(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: pkg.name ?? (dir === ROOT_DIR ? "workspace" : dir),
        scripts: pkg.scripts ?? {},
      }),
    );
    for (const [file, contents] of Object.entries(pkg.files ?? {})) {
      write(path.join(dir, file), contents);
    }
  }
  if (!(ROOT_DIR in packages)) {
    write("package.json", JSON.stringify({ name: "workspace", scripts: {} }));
  }
  return root;
}

/** A Playwright config, recognized here the way the real ones are. */
const config = (
  suite: string,
): string => `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /${suite}\\.spec\\.ts/,
});
`;

/** The release chain, every part of it joined the way the real one is. */
const release = (...commands: string[]): Record<string, string> => ({
  [RELEASE_SCRIPT]: commands.join(" && "),
});

/** A suite declared for a throwaway workspace, needing what it is given. */
const declares = (name: string, required: readonly string[]): BrowserSuite => ({
  label: `${name} browser checks`,
  config: `${name}.config.ts`,
  spec: `${name}.spec.ts`,
  required,
  covers: [`whatever the ${name} cases cover`],
});

/** A workspace whose release command chains the suites it is given. */
function chainOf(t: TestContext, suites: readonly BrowserSuite[]) {
  const files: Record<string, string> = {};
  const scripts: Record<string, string> = {};
  for (const suite of suites) {
    const name = suite.config.replace(/\.config\.ts$/, "");
    files[`e2e/${suite.config}`] = config(name);
    scripts[`test:e2e:${name}`] =
      `playwright test --config e2e/${suite.config}`;
  }
  return workspace(t, {
    [ROOT_DIR]: {
      scripts: release(
        ...Object.keys(scripts).map(
          (script) => `pnpm --filter ${API} run ${script}`,
        ),
      ),
    },
    [API]: { scripts, files },
  });
}

/** Settings shaped like real ones, all invented here. */
const CONFIGURED: Record<string, string> = {
  E2E_CHAT_URL: "https://chat.example.test",
  E2E_API_URL: "https://api.example.test",
  CLERK_PUBLISHABLE_KEY: "pk_test_example",
  CLERK_SECRET_KEY: "sk_test_example",
  DATABASE_URL: "postgresql://appuser:pw@db.example.test:5432/appdb",
  E2E_MODERATOR_EMAIL: "admin1@example.test",
  E2E_MODERATOR_PASSWORD: "not-a-real-password-1",
  E2E_MODERATOR_EMAIL_2: "admin2@example.test",
  E2E_MODERATOR_PASSWORD_2: "not-a-real-password-2",
};

test("a chain whose settings are all provided is cleared to start", (t) => {
  const smoke = declares("smoke", ["E2E_CHAT_URL", "E2E_API_URL"]);
  const rooms = declares("rooms", ["E2E_CHAT_URL", "DATABASE_URL"]);
  const root = chainOf(t, [smoke, rooms]);

  const { failure, notice } = readReleaseSettings(root, CONFIGURED, [
    smoke,
    rooms,
  ]);

  assert.equal(failure, null);
  assert.ok(notice.includes(smoke.label) && notice.includes(rooms.label));
});

test("every setting the chain needs is named before its first suite", (t) => {
  const smoke = declares("smoke", ["E2E_CHAT_URL", "E2E_API_URL"]);
  const rooms = declares("rooms", ["E2E_CHAT_URL", "DATABASE_URL"]);
  const moderation = declares("moderation", [
    "E2E_CHAT_URL",
    "E2E_MODERATOR_PASSWORD",
  ]);
  const root = chainOf(t, [smoke, rooms, moderation]);

  // The setting the last suite signs in with, and one the second needs: the
  // chain used to report the second only, after the first suite had run, and
  // the third only on the run after that.
  const { failure } = readReleaseSettings(
    root,
    { ...CONFIGURED, DATABASE_URL: "", E2E_MODERATOR_PASSWORD: undefined },
    [smoke, rooms, moderation],
  );

  assert.ok(failure, "a chain that cannot finish should not start");
  assert.match(failure, /DATABASE_URL, E2E_MODERATOR_PASSWORD are not set/);
  assert.match(failure, new RegExp(`- DATABASE_URL: ${rooms.label}`));
  assert.match(
    failure,
    new RegExp(`- E2E_MODERATOR_PASSWORD: ${moderation.label}`),
  );
});

test("a chain of one suite is held to that suite's settings alone", (t) => {
  const layout = declares("layout", ["E2E_CHAT_URL"]);
  const root = chainOf(t, [layout]);

  const { failure } = readReleaseSettings(
    root,
    { ...CONFIGURED, E2E_MODERATOR_PASSWORD: undefined },
    [layout, declares("moderation", ["E2E_MODERATOR_PASSWORD"])],
  );

  assert.equal(
    failure,
    null,
    "a suite the command does not run states nothing this run needs",
  );
});

test("a suite's own command is left to decide for itself", () => {
  // The third thing this must not break: running one suite on its own still
  // reports that suite's settings and no other's. It does that because this
  // reading stands in front of the chain and nowhere else -- so no suite's
  // own script reaches it.
  const scripts: Record<string, string> = JSON.parse(
    readFileSync(path.join(WORKSPACE_ROOT, API, "package.json"), "utf8"),
  ).scripts;

  for (const [name, command] of Object.entries(scripts)) {
    if (!name.startsWith("test:e2e:")) continue;
    assert.ok(
      !command.includes(RELEASE_SETTINGS_SCRIPT),
      `${name} runs the chain's reading, so a suite run alone would be held to the whole chain's settings: ${command}`,
    );
  }
});

test("the release command makes this reading before its first suite", () => {
  const scripts: Record<string, string> = JSON.parse(
    readFileSync(path.join(WORKSPACE_ROOT, "package.json"), "utf8"),
  ).scripts;
  const chain = scripts[RELEASE_SCRIPT] ?? "";
  const first = chain.split("&&")[0] ?? "";

  assert.ok(
    first.includes(RELEASE_SETTINGS_SCRIPT),
    `the first thing \`pnpm run ${RELEASE_SCRIPT}\` does has to be this reading, or a missing setting is found partway through again: ${chain}`,
  );
  assert.ok(
    RELEASE_SETTINGS_SCRIPT in scripts,
    "and the root package.json has to declare the script that makes it",
  );
});

test("a config the chain runs that nothing declares fails", (t) => {
  const smoke = declares("smoke", ["E2E_CHAT_URL"]);
  const rooms = declares("rooms", ["DATABASE_URL"]);
  const root = chainOf(t, [smoke, rooms]);

  // The rooms suite's declaration went, or was never written: nothing states
  // what it needs, so the union cannot hold it and a run cleared here would
  // still stop inside that suite.
  const { failure } = readReleaseSettings(root, CONFIGURED, [smoke]);

  assert.ok(failure, "a suite nothing declares is a suite this cannot read");
  assert.match(failure, /declared by no BrowserSuite/);
  assert.match(failure, new RegExp(`runs: ${E2E}/rooms\\.config\\.ts`));
});

test("a release command reaching no browser suite fails", (t) => {
  const root = workspace(t, {
    [ROOT_DIR]: { scripts: release("echo nothing to validate") },
    [API]: { scripts: { test: "vitest run src" } },
  });

  const { failure } = readReleaseSettings(root, CONFIGURED, []);

  assert.ok(failure, "a reading with nothing to read clears every run");
  assert.match(failure, /reaches no browser suite/);
});

test("a waived chain is not held to the settings it will not use", (t) => {
  const moderation = declares("moderation", ["E2E_MODERATOR_PASSWORD"]);
  const root = chainOf(t, [moderation]);

  const { failure, notice } = readReleaseSettings(
    root,
    { BROWSER_TESTS: "skip" },
    [moderation],
  );

  assert.equal(failure, null, "the waiver means do not touch them");
  assert.match(notice, /BROWSER_TESTS=skip/);
});

test("the suites are read off the shared module, not listed here", () => {
  const suites = declaredSuites();

  assert.ok(
    suites.includes(MODERATION_SUITE),
    "a suite declared in the shared module is one of the chain's",
  );
  assert.ok(
    !suites.some((suite) => suite.label === MODERATION_RECOVERY_COMMAND.label),
    "a command declared beside them is not a browser suite",
  );
});

test("this workspace's release command is held to what its suites declare", () => {
  const empty = readReleaseSettings(WORKSPACE_ROOT, {});
  assert.ok(empty.failure, "an environment providing nothing cannot start it");

  // Every setting the suites the chain runs declare, named in one notice:
  // read off those declarations, so a suite that starts needing another one
  // is covered here without this test being touched.
  for (const name of new Set(
    declaredSuites().flatMap((suite) => suite.required),
  )) {
    if (!empty.failure.includes(name)) continue; // a suite outside the chain
    assert.match(empty.failure, new RegExp(`- ${name}: `));
  }
  assert.match(empty.failure, /E2E_MODERATOR_PASSWORD_2/);
  assert.match(empty.failure, /E2E_CHAT_URL/);

  const provided = readReleaseSettings(WORKSPACE_ROOT, CONFIGURED);
  assert.equal(
    provided.failure,
    null,
    "and one providing every declared setting starts it",
  );
});
