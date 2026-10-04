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
  ANNOUNCE_FUNCTION,
  checkWorkspace,
  DECLARATION_DIR,
  GLOBAL_SETUP_KEY,
  inspectConfig,
  OPTIONAL_KEY,
  OPTIONAL_LINE_KEY,
  OPTIONAL_NAME_KEY,
  readEnvironmentUses,
  readGlobalSetupValue,
  readSuiteDeclarations,
  readWorkspaceDeclarations,
  REQUIRED_KEY,
  REQUIREMENT_MODULE,
  REQUIREMENT_PACKAGE,
  settingsReadInWorkspace,
  SUITE_TYPE,
  TEST_MATCH_KEY,
  UNUSED_KEY,
} from "../src/checkBrowserTestRequirements.ts";
import {
  findPlaywrightConfigs,
  stripComments,
} from "../src/playwrightConfigs.ts";
import { escapeRegExp } from "./escapeRegExp.ts";

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** A `globalSetup` module of the shape every browser suite's one has. */
function requirement(suite = "MODERATION_SUITE"): string {
  return `import { ${ANNOUNCE_FUNCTION}, ${suite} } from "${REQUIREMENT_PACKAGE}";
export default function setup(): void {
  ${ANNOUNCE_FUNCTION}(${suite});
}
`;
}

/** A config collecting one spec file, with whatever else the case needs. */
function config(body: string, spec = "moderation.spec.ts"): string {
  return `import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  ${TEST_MATCH_KEY}: /${escapeRegExp(spec)}/,
${body}});
`;
}

/** What the shared module says about one suite: who runs it, and what. */
interface SuiteSpec {
  /** Export name, which is what a requirement module announces. */
  name: string;
  /** The config that runs it: a bare name, or a workspace-relative path. */
  config: string;
  /** The spec that config runs, named the same way. */
  spec: string;
  /** That spec is written to disk unless this says otherwise. */
  specOnDisk?: boolean;
  /** Settings the declaration says it cannot run without. */
  required?: readonly string[];
  /** Settings it states its cases read but a run may go without. */
  optional?: readonly string[];
  /** Settings it states its cases are meant never to reach. */
  unused?: readonly string[];
  /** Written verbatim as the `required` entry, for one nothing can read. */
  requiredExpression?: string;
  /** Written verbatim as the `optional` entry, for an entry of another shape. */
  optionalExpression?: string;
  /** Written verbatim as the `unused` entry, for an entry of another shape. */
  unusedExpression?: string;
}

/** Names written the way a settings list in the shared module writes them. */
const settingsList = (names: readonly string[]): string =>
  `[${names.map((name) => `"${name}"`).join(", ")}]`;

/**
 * The same for `optional`, whose entries are not bare names: each states the
 * setting's name beside the line the run prints with it, saying what its
 * cases do without that setting.
 */
const optionalList = (names: readonly string[]): string =>
  `[${names
    .map(
      (name) =>
        `{ ${OPTIONAL_NAME_KEY}: "${name}", ${OPTIONAL_LINE_KEY}: "what ${name} costs this run" }`,
    )
    .join(", ")}]`;

/**
 * The same for `unused`, whose entries state a name beside the reason these
 * cases are meant never to reach that setting.
 */
const unusedList = (names: readonly string[]): string =>
  `[${names
    .map(
      (name) =>
        `{ ${OPTIONAL_NAME_KEY}: "${name}", why: "why ${name} is none of this suite's business" }`,
    )
    .join(", ")}]`;

const MODERATION_DECLARATION: SuiteSpec = {
  name: "MODERATION_SUITE",
  config: "playwright.moderation.config.ts",
  spec: "moderation.spec.ts",
};

const BANNED_ROOM_DECLARATION: SuiteSpec = {
  name: "BANNED_ROOM_SUITE",
  config: "playwright.config.ts",
  spec: "banned-room.spec.ts",
};

/**
 * The shared requirement module, declaring the suites a case needs.
 *
 * `announce` is the announcement itself, which a case only writes out where
 * what it does with the environment it is handed is the thing being tested:
 * the real one reads the suite's own settings off it by names it builds as
 * it goes, which is what a `globalSetup` module handing it the environment
 * would otherwise be reported for.
 */
function sharedModule(
  suites: readonly SuiteSpec[],
  preamble: string = "",
  announce: string = `export function ${ANNOUNCE_FUNCTION}(): void {}`,
): string {
  return [
    `export interface ${SUITE_TYPE} {`,
    "  label: string;",
    "  config: string;",
    "  spec: string;",
    `  ${REQUIRED_KEY}: string[];`,
    `  ${OPTIONAL_KEY}?: { ${OPTIONAL_NAME_KEY}: string; ${OPTIONAL_LINE_KEY}: string }[];`,
    `  ${UNUSED_KEY}?: { ${OPTIONAL_NAME_KEY}: string; why: string }[];`,
    "  covers: string[];",
    "}",
    announce,
    preamble,
    ...suites.map((suite) =>
      [
        `export const ${suite.name}: ${SUITE_TYPE} = {`,
        `  label: "${suite.name}",`,
        `  config: "${suite.config}",`,
        `  spec: "${suite.spec}",`,
        `  ${REQUIRED_KEY}: ${suite.requiredExpression ?? settingsList(suite.required ?? [])},`,
        ...((suite.optionalExpression ?? suite.optional)
          ? [
              `  ${OPTIONAL_KEY}: ${suite.optionalExpression ?? optionalList(suite.optional ?? [])},`,
            ]
          : []),
        ...((suite.unusedExpression ?? suite.unused)
          ? [
              `  ${UNUSED_KEY}: ${suite.unusedExpression ?? unusedList(suite.unused ?? [])},`,
            ]
          : []),
        "  covers: [],",
        "};",
      ].join("\n"),
    ),
    "",
  ].join("\n");
}

interface WorkspaceSpec {
  /** Files to write, workspace-relative path to contents. */
  files: Record<string, string>;
  /** Suites the shared module declares; their spec files are written too. */
  suites?: readonly SuiteSpec[];
  /** The shared requirement module is written unless this says otherwise. */
  withRequirementModule?: boolean;
  /** Written into the shared module above its suites, for a shared list. */
  sharedPreamble?: string;
  /** The shared module's own announcement, where a case is about that call. */
  announce?: string;
}

/** Shorthand for a file inside the directory holding the browser suites. */
const e2e = (name: string): string => `${DECLARATION_DIR}/${name}`;

/** Where a declared config name lands: a bare one sits with the suites. */
const declaredConfig = (name: string): string =>
  name.includes("/") ? name : e2e(name);

/** Where a declared spec name lands: a bare one sits beside its config. */
const declaredSpec = (suite: SuiteSpec): string =>
  suite.spec.includes("/")
    ? suite.spec
    : `${path.posix.dirname(declaredConfig(suite.config))}/${suite.spec}`;

/** A throwaway workspace on disk, removed when the test ends. */
function workspace(t: TestContext, spec: WorkspaceSpec): string {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "browser-requirement-check-"),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const suites = spec.suites ?? [MODERATION_DECLARATION];
  const files = { ...spec.files };
  if (spec.withRequirementModule !== false) {
    files[REQUIREMENT_MODULE] = sharedModule(
      suites,
      spec.sharedPreamble,
      spec.announce,
    );
  }
  for (const suite of suites) {
    if (suite.specOnDisk === false) continue;
    files[declaredSpec(suite)] ??= `import { test } from "@playwright/test";
test("a case", async () => {});
`;
  }
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

test("a config naming its own suite's requirement module passes", (t) => {
  const root = workspace(t, {
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
    },
  });

  assert.equal(checkWorkspace(root), null);
});

test("a new config without its settings check fails", (t) => {
  const root = workspace(t, {
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
      // The third suite someone adds later, wired to nothing.
      [e2e("playwright.rooms.config.ts")]: config("  workers: 1,\n"),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a config that decides nothing should fail the check");
  assert.match(failure, /playwright\.rooms\.config\.ts/);
  assert.match(failure, new RegExp(`names no ${GLOBAL_SETUP_KEY}`));
  assert.doesNotMatch(
    failure,
    /playwright\.moderation\.config\.ts/,
    "the compliant config should not be reported",
  );
});

test("deciding at config module scope is not deciding once per run", (t) => {
  const root = workspace(t, {
    suites: [
      {
        name: "LAUNCH_SMOKE_SUITE",
        config: "playwright.launch.config.ts",
        spec: "launch-smoke.spec.ts",
      },
    ],
    files: {
      [e2e("playwright.launch.config.ts")]:
        `import { defineConfig } from "@playwright/test";

if (!process.env["E2E_CHAT_URL"]) {
  throw new Error("Set E2E_CHAT_URL to the running Chat App preview URL.");
}

export default defineConfig({ testDir: "." });
`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a module-scope throw runs again in every worker");
  assert.match(failure, /playwright\.launch\.config\.ts/);
});

test("a globalSetup module that is not there fails", (t) => {
  const root = workspace(t, {
    suites: [BANNED_ROOM_DECLARATION],
    files: {
      [e2e("playwright.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./banned-room.requirement.ts",\n`,
        "banned-room.spec.ts",
      ),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a renamed or deleted module leaves nothing deciding");
  assert.match(failure, /is not there/);
  assert.match(failure, /banned-room\.requirement\.ts/);
});

test("a globalSetup module that announces nothing fails", (t) => {
  const root = workspace(t, {
    suites: [BANNED_ROOM_DECLARATION],
    files: {
      [e2e("playwright.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./banned-room.requirement.ts",\n`,
        "banned-room.spec.ts",
      ),
      [e2e("banned-room.requirement.ts")]:
        `export default function setup(): void {
  console.log("running the banned-room checks");
}
`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a setup module that decides nothing is not a requirement",
  );
  assert.match(failure, new RegExp(`never calls ${ANNOUNCE_FUNCTION}`));
});

test("announcing through a local copy of the name is not announcing", (t) => {
  const root = workspace(t, {
    suites: [BANNED_ROOM_DECLARATION],
    files: {
      [e2e("playwright.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./banned-room.requirement.ts",\n`,
        "banned-room.spec.ts",
      ),
      [e2e("banned-room.requirement.ts")]:
        `import { ${ANNOUNCE_FUNCTION} } from "./localAnnounce";
export default function setup(): void {
  ${ANNOUNCE_FUNCTION}();
}
`,
      [e2e("localAnnounce.ts")]:
        `export function ${ANNOUNCE_FUNCTION}(): void {}\n`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "only the shared module knows what each suite needs");
  assert.match(failure, new RegExp(escapeRegExp(REQUIREMENT_MODULE)));
});

test("a globalSetup built at runtime cannot be followed to a module", (t) => {
  const root = workspace(t, {
    suites: [BANNED_ROOM_DECLARATION],
    files: {
      [e2e("playwright.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: setupModule(),\n`,
        "banned-room.spec.ts",
      ),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a path this check cannot read is a path nobody reviews");
  assert.match(failure, /not a module path/);
});

test("a commented-out globalSetup is not wiring", (t) => {
  const root = workspace(t, {
    suites: [BANNED_ROOM_DECLARATION],
    files: {
      [e2e("playwright.config.ts")]: config(
        `  // ${GLOBAL_SETUP_KEY}: "./banned-room.requirement.ts",\n`,
        "banned-room.spec.ts",
      ),
      [e2e("banned-room.requirement.ts")]: requirement("BANNED_ROOM_SUITE"),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a config only mentioning the key in a comment decides nothing",
  );
  assert.match(failure, new RegExp(`names no ${GLOBAL_SETUP_KEY}`));
});

test("a config wired to another suite's requirement module fails", (t) => {
  const root = workspace(t, {
    suites: [
      {
        name: "AUTH_LAYOUT_SUITE",
        config: "playwright.auth-layout.config.ts",
        spec: "auth-layout-visual.spec.ts",
      },
      {
        name: "LAUNCH_SMOKE_SUITE",
        config: "playwright.launch-smoke.config.ts",
        spec: "launch-smoke.spec.ts",
      },
    ],
    files: {
      [e2e("playwright.auth-layout.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./auth-layout.requirement.ts",\n`,
        "auth-layout-visual.spec.ts",
      ),
      [e2e("auth-layout.requirement.ts")]: requirement("AUTH_LAYOUT_SUITE"),
      // Copied from the config above and left pointing at its requirement
      // module: this run would ask for the sign-in layout suite's one
      // setting, then fail inside a case for a Clerk key nobody said was
      // missing.
      [e2e("playwright.launch-smoke.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./auth-layout.requirement.ts",\n`,
        "launch-smoke.spec.ts",
      ),
      [e2e("launch-smoke.requirement.ts")]: requirement("LAUNCH_SMOKE_SUITE"),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "the settings it demands are another suite's");
  assert.match(failure, /playwright\.launch-smoke\.config\.ts/);
  assert.match(failure, /AUTH_LAYOUT_SUITE/);
  assert.match(failure, /LAUNCH_SMOKE_SUITE/);
  assert.match(
    failure,
    /launch-smoke\.spec\.ts/,
    "the report should name the spec that settles which suite this is",
  );
  assert.doesNotMatch(
    failure,
    /playwright\.auth-layout\.config\.ts/,
    "the config it was copied from is correctly wired",
  );
});

test("a config no suite claims fails, however well it is wired", (t) => {
  const root = workspace(t, {
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
      // A real requirement module, announcing a real suite — but not this
      // config's, and nothing here says which one that would be.
      [e2e("playwright.rooms.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
        "rooms.spec.ts",
      ),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "an unclaimed config is checked against nothing");
  assert.match(failure, /playwright\.rooms\.config\.ts/);
  assert.match(failure, new RegExp(`No ${SUITE_TYPE} in|names this config`));
});

test("a suite naming a spec its config does not collect fails", (t) => {
  const root = workspace(t, {
    suites: [
      {
        name: "MODERATION_SUITE",
        config: "playwright.moderation.config.ts",
        spec: "rooms.spec.ts",
      },
    ],
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a declaration that does not match the run is not a fact");
  assert.match(failure, new RegExp(`${TEST_MATCH_KEY} does not collect it`));
});

test("a suite naming a spec file that is not there fails", (t) => {
  const root = workspace(t, {
    suites: [{ ...MODERATION_DECLARATION, specOnDisk: false }],
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a renamed spec leaves the declaration pointing nowhere");
  assert.match(failure, /moderation\.spec\.ts.+is not there|is not there/);
});

test("a suite naming a config that is not there fails", (t) => {
  const root = workspace(t, {
    suites: [
      MODERATION_DECLARATION,
      {
        name: "ROOMS_SUITE",
        config: "playwright.rooms.config.ts",
        spec: "rooms.spec.ts",
      },
    ],
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a declaration outliving its config is not checked");
  assert.match(failure, /playwright\.rooms\.config\.ts/);
  assert.match(failure, /no such Playwright config/);
});

test("two suites claiming one config leave it deciding nothing definite", (t) => {
  const root = workspace(t, {
    suites: [
      MODERATION_DECLARATION,
      {
        name: "MODERATION_HISTORY_SUITE",
        config: "playwright.moderation.config.ts",
        spec: "moderation.spec.ts",
      },
    ],
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "two answers to which settings a run needs is none");
  assert.match(failure, /MODERATION_HISTORY_SUITE/);
  assert.match(failure, /ambiguous/);
});

test("announcing a suite built in the setup module is not announcing one", (t) => {
  const root = workspace(t, {
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]:
        `import { ${ANNOUNCE_FUNCTION} } from "${REQUIREMENT_PACKAGE}";
export default function setup(): void {
  ${ANNOUNCE_FUNCTION}({ label: "Moderation", required: [], covers: [] });
}
`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a suite invented here is not the declared one");
  assert.match(failure, /MODERATION_SUITE/);
});

test("a config collecting its spec by glob, or by default, still counts", (t) => {
  const root = workspace(t, {
    suites: [MODERATION_DECLARATION],
    files: {
      // A glob narrow enough to collect this suite's spec and no other.
      [e2e("playwright.moderation.config.ts")]:
        `import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  ${TEST_MATCH_KEY}: "**/moderation.spec.ts",
  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",
});
`,
      [e2e("moderation.requirement.ts")]: requirement(),
    },
  });

  const single = workspace(t, {
    suites: [BANNED_ROOM_DECLARATION],
    files: {
      // No testMatch at all: Playwright's default collects every spec file in
      // testDir, which here is this suite's own and nothing else.
      [e2e("playwright.config.ts")]:
        `import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  ${GLOBAL_SETUP_KEY}: "./banned-room.requirement.ts",
});
`,
      [e2e("banned-room.requirement.ts")]: requirement("BANNED_ROOM_SUITE"),
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "a config may collect its spec by glob",
  );
  assert.equal(
    checkWorkspace(single),
    null,
    "a config may collect its spec by Playwright's default",
  );
});

test("a config also sweeping up another suite's cases fails", (t) => {
  const root = workspace(t, {
    suites: [MODERATION_DECLARATION, BANNED_ROOM_DECLARATION],
    files: {
      // Its testMatch was dropped, so Playwright's default collects the
      // moderation spec too — cases that would run on the banned-room
      // suite's settings, which are not the ones declared for them.
      [e2e("playwright.config.ts")]:
        `import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  ${GLOBAL_SETUP_KEY}: "./banned-room.requirement.ts",
});
`,
      [e2e("banned-room.requirement.ts")]: requirement("BANNED_ROOM_SUITE"),
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "those cases run without the settings they need");
  assert.match(failure, /playwright\.config\.ts/);
  assert.match(failure, /moderation\.spec\.ts/);
  assert.match(failure, /MODERATION_SUITE/);
  assert.doesNotMatch(
    failure,
    /playwright\.moderation\.config\.ts\n/,
    "the config that collects only its own spec is correctly wired",
  );
});

test("a declared spec renamed to another extension is not that spec", (t) => {
  const root = workspace(t, {
    suites: [{ ...MODERATION_DECLARATION, specOnDisk: false }],
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
      // Renamed, while the declaration and the testMatch still name the .ts:
      // this run collects nothing at all.
      [e2e("moderation.spec.js")]: `test("a case", async () => {});\n`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a spec named .ts is not a file named .js");
  assert.match(failure, /moderation\.spec\.ts/);
  assert.match(failure, /is not there/);
});

test("a spec file is not a config, and an oddly named config still is", (t) => {
  const root = workspace(t, {
    files: {
      [e2e("moderation.spec.ts")]:
        `import { expect, test } from "@playwright/test";
test("bans an account", async () => { expect(1).toBe(1); });
`,
      [e2e("moderation.fixture.ts")]:
        `import { test as base } from "@playwright/test";
export const test = base.extend({});
`,
      [e2e("playwrightRooms.ts")]:
        `import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "." });
`,
    },
  });

  assert.deepEqual(findPlaywrightConfigs(root, DECLARATION_DIR), [
    e2e("playwrightRooms.ts"),
  ]);
});

test("the value read is the whole entry, however it is written", () => {
  assert.equal(
    readGlobalSetupValue(
      `export default { ${GLOBAL_SETUP_KEY}: "./a.ts", workers: 1 }`,
    ),
    '"./a.ts"',
  );
  assert.equal(
    readGlobalSetupValue(
      `export default {\n  ${GLOBAL_SETUP_KEY}: ["./a.ts", "./b.ts"],\n}`,
    ),
    '["./a.ts", "./b.ts"]',
  );
  assert.equal(readGlobalSetupValue("export default { workers: 1 }"), null);
});

test("each suite's config and spec are read from its declaration", () => {
  const declarations = readSuiteDeclarations(
    sharedModule([MODERATION_DECLARATION, BANNED_ROOM_DECLARATION]),
  );

  assert.deepEqual(declarations, [
    {
      suite: "MODERATION_SUITE",
      config: e2e("playwright.moderation.config.ts"),
      configAsWritten: "playwright.moderation.config.ts",
      spec: e2e("moderation.spec.ts"),
      required: [],
      optional: [],
      unsaid: [],
      unused: [],
      unreadable: [],
    },
    {
      suite: "BANNED_ROOM_SUITE",
      config: e2e("playwright.config.ts"),
      configAsWritten: "playwright.config.ts",
      spec: e2e("banned-room.spec.ts"),
      required: [],
      optional: [],
      unsaid: [],
      unused: [],
      unreadable: [],
    },
  ]);
});

test("a bare spec name is read beside the config its suite names", () => {
  const tabs = "artifacts/chat-app/e2e/playwright.tabs.config.ts";
  const declarations = readSuiteDeclarations(
    sharedModule([{ name: "TABS_SUITE", config: tabs, spec: "tabs.spec.ts" }]),
  );

  assert.deepEqual(declarations, [
    {
      suite: "TABS_SUITE",
      config: tabs,
      configAsWritten: tabs,
      // Not artifacts/api-server/e2e/tabs.spec.ts: the short form belongs to
      // the package the config is in, which is where Playwright collects it.
      spec: "artifacts/chat-app/e2e/tabs.spec.ts",
      required: [],
      optional: [],
      unsaid: [],
      unused: [],
      unreadable: [],
    },
  ]);
});

test("a declaration naming no config is not read as the next one's", () => {
  const declarations = readSuiteDeclarations(
    `export const ROOMS_SUITE: ${SUITE_TYPE} = {
  label: "Rooms",
  spec: "rooms.spec.ts",
  required: [],
  covers: ["what a config: spec pairing is not"],
};
export const MODERATION_SUITE: ${SUITE_TYPE} = {
  label: "Moderation",
  config: "playwright.moderation.config.ts",
  spec: "moderation.spec.ts",
  required: [],
  covers: [],
};
`,
  );

  assert.deepEqual(declarations, [
    {
      suite: "MODERATION_SUITE",
      config: e2e("playwright.moderation.config.ts"),
      configAsWritten: "playwright.moderation.config.ts",
      spec: e2e("moderation.spec.ts"),
      required: [],
      optional: [],
      unsaid: [],
      unused: [],
      unreadable: [],
    },
  ]);
});

test("renaming the import still announces the suite it was exported as", (t) => {
  const root = workspace(t, {
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: `import {
  ${ANNOUNCE_FUNCTION},
  MODERATION_SUITE as SUITE,
} from "${REQUIREMENT_PACKAGE}";
export default function setup(): void {
  ${ANNOUNCE_FUNCTION}(SUITE);
}
`,
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "the local name is not the suite; what the shared module exports it as is",
  );
});

test("one of several globalSetup modules announcing the decision is enough", (t) => {
  const root = workspace(t, {
    suites: [BANNED_ROOM_DECLARATION],
    files: {
      [e2e("playwright.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: ["./seedRooms.ts", "./banned-room.requirement.ts"],\n`,
        "banned-room.spec.ts",
      ),
      [e2e("seedRooms.ts")]: "export default function seed(): void {}\n",
      [e2e("banned-room.requirement.ts")]: requirement("BANNED_ROOM_SUITE"),
    },
  });

  assert.equal(checkWorkspace(root), null);
  assert.equal(inspectConfig(root, e2e("playwright.config.ts")), null);
});

test("a config in another artifact is held to the same wiring", (t) => {
  const root = workspace(t, {
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
      // A browser suite someone adds to the mobile app, wired to nothing.
      "artifacts/chat-app/e2e/playwright.tabs.config.ts":
        config("  workers: 1,\n"),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "the convention is the workspace's, not one package's");
  assert.match(failure, /chat-app\/e2e\/playwright\.tabs\.config\.ts/);
  assert.match(failure, new RegExp(`names no ${GLOBAL_SETUP_KEY}`));
});

test("a config above the packages is held to it too", (t) => {
  const root = workspace(t, {
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
      // A config at the workspace root, under no package at all.
      "playwright.config.ts": config("  workers: 1,\n"),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a config above artifacts/ decides nothing either");
  assert.match(failure, /^ {2}playwright\.config\.ts$/m);
});

test("a suite in another package names its config, spec, and the shared library", (t) => {
  const tabs = "artifacts/chat-app/e2e/playwright.tabs.config.ts";
  const root = workspace(t, {
    suites: [
      MODERATION_DECLARATION,
      {
        name: "TABS_SUITE",
        config: tabs,
        spec: "artifacts/chat-app/e2e/tabs.spec.ts",
      },
    ],
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
      [tabs]: config(
        `  ${GLOBAL_SETUP_KEY}: "./tabs.requirement.ts",\n`,
        "tabs.spec.ts",
      ),
      // Announced the way any package reaches a shared library: by package
      // name. Reaching into another artifact for the same file is not how
      // anything else here is imported, and this package's own typecheck
      // would not resolve it.
      "artifacts/chat-app/e2e/tabs.requirement.ts": `import { ${ANNOUNCE_FUNCTION}, TABS_SUITE } from "${REQUIREMENT_PACKAGE}";
export default function setup(): void {
  ${ANNOUNCE_FUNCTION}(TABS_SUITE);
}
`,
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "a suite names a config in another package by its workspace path",
  );
});

test("a suite in another package may still name its spec the short way", (t) => {
  const tabs = "artifacts/chat-app/e2e/playwright.tabs.config.ts";
  const root = workspace(t, {
    suites: [
      MODERATION_DECLARATION,
      // The spec sits beside the config that runs it, which is where
      // Playwright collects it from, so the short form means that file —
      // not one in the package these suites started in.
      { name: "TABS_SUITE", config: tabs, spec: "tabs.spec.ts" },
    ],
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
      [tabs]: config(
        `  ${GLOBAL_SETUP_KEY}: "./tabs.requirement.ts",\n`,
        "tabs.spec.ts",
      ),
      "artifacts/chat-app/e2e/tabs.requirement.ts": `import { ${ANNOUNCE_FUNCTION}, TABS_SUITE } from "${REQUIREMENT_PACKAGE}";
export default function setup(): void {
  ${ANNOUNCE_FUNCTION}(TABS_SUITE);
}
`,
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "a short spec name belongs to the package its own config is in",
  );
});

test("a suite naming a config the short way from another package is told where that lands", (t) => {
  const tabs = "artifacts/chat-app/e2e/playwright.tabs.config.ts";
  const root = workspace(t, {
    suites: [
      MODERATION_DECLARATION,
      // The short form of a config name belongs to one directory, and this
      // suite's config is not in it.
      {
        name: "TABS_SUITE",
        config: "playwright.tabs.config.ts",
        spec: "tabs.spec.ts",
        specOnDisk: false,
      },
    ],
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
      [tabs]: config(
        `  ${GLOBAL_SETUP_KEY}: "./tabs.requirement.ts",\n`,
        "tabs.spec.ts",
      ),
      "artifacts/chat-app/e2e/tabs.spec.ts": `import { test } from "@playwright/test";
test("a case", async () => {});
`,
      "artifacts/chat-app/e2e/tabs.requirement.ts": `import { ${ANNOUNCE_FUNCTION}, TABS_SUITE } from "${REQUIREMENT_PACKAGE}";
export default function setup(): void {
  ${ANNOUNCE_FUNCTION}(TABS_SUITE);
}
`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a short name naming no config there is not a config");
  assert.match(
    failure,
    /names it `playwright\.tabs\.config\.ts`/,
    "the report answers the name the declaration wrote",
  );
  assert.match(
    failure,
    new RegExp(`read in ${DECLARATION_DIR}/`),
    "and says where a name written that short is looked for",
  );
  assert.match(
    failure,
    /artifacts\/chat-app\/e2e\/playwright\.tabs\.config\.ts is named that/,
    "naming the config in the tree that the declaration meant",
  );
  assert.match(
    failure,
    new RegExp(
      `outside ${DECLARATION_DIR} names it by its workspace-relative path`,
    ),
  );
});

test("another tool's config in the tree is not a Playwright config", (t) => {
  const root = workspace(t, {
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
      "artifacts/api-server/vitest.config.ts": `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
`,
      "artifacts/chat-app/jest.config.js":
        "module.exports = { preset: 'jest-expo' };\n",
      "lib/db/drizzle.config.ts": `import { defineConfig } from "drizzle-kit";
export default defineConfig({ schema: "./src/schema.ts" });
`,
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "a vitest, jest, or drizzle config decides no browser suite's settings",
  );
});

test("finding no config at all is a failure, not an empty pass", (t) => {
  const root = workspace(t, { suites: [], files: {} });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a check with nothing to check reports the same green");
  assert.match(failure, /No Playwright config/);
});

test("declaring no suite at all is a failure, not an empty pass", (t) => {
  const root = workspace(t, {
    suites: [],
    files: {
      [e2e("playwright.moderation.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./moderation.requirement.ts",\n`,
      ),
      [e2e("moderation.requirement.ts")]: requirement(),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "with nothing declared, every config is held to nothing");
  assert.match(failure, new RegExp(`No ${SUITE_TYPE} in`));
});

test("the shared requirement module going missing is reported on its own", (t) => {
  const root = workspace(t, {
    withRequirementModule: false,
    suites: [BANNED_ROOM_DECLARATION],
    files: {
      [e2e("playwright.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./banned-room.requirement.ts",\n`,
        "banned-room.spec.ts",
      ),
      [e2e("banned-room.requirement.ts")]: requirement("BANNED_ROOM_SUITE"),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "nothing can announce a decision through a file that is gone",
  );
  assert.match(failure, /no longer there/);
});

/** A declaration whose spec is written by the case, so it can read settings. */
const AUTH_LAYOUT_DECLARATION: SuiteSpec = {
  name: "AUTH_LAYOUT_SUITE",
  config: "playwright.auth-layout.config.ts",
  spec: "auth-layout-visual.spec.ts",
};

/** That suite, correctly wired, with whatever spec the case wants to run. */
function settingsWorkspace(
  t: TestContext,
  suite: Partial<SuiteSpec>,
  spec: string,
  extra: Record<string, string> = {},
  sharedPreamble?: string,
): string {
  return workspace(t, {
    suites: [{ ...AUTH_LAYOUT_DECLARATION, ...suite }],
    sharedPreamble,
    files: {
      [e2e("playwright.auth-layout.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./auth-layout.requirement.ts",\n`,
        "auth-layout-visual.spec.ts",
      ),
      [e2e("auth-layout.requirement.ts")]: requirement("AUTH_LAYOUT_SUITE"),
      [e2e("auth-layout-visual.spec.ts")]: spec,
      ...extra,
    },
  });
}

test("a case reading a setting its suite never asked for fails", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("reaches the API", async () => {
  await fetch(\`\${process.env["E2E_API_URL"]}/api/health\`);
});
`,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "this run starts and then fails inside the case");
  assert.match(
    failure,
    new RegExp(`read E2E_API_URL, which AUTH_LAYOUT_SUITE declares neither`),
    "the report should name the setting and the suite that does not ask for it",
  );
  assert.match(
    failure,
    /E2E_API_URL is read in: .*auth-layout-visual\.spec\.ts/,
    "and where it is read, which is most of deciding what to do about it",
  );
});

test("a read written straight after a keyword is a read like any other", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
function apiUrl(): string {
  return process.env.E2E_API_URL ?? "http://localhost:3000";
}
test("reaches the API", async () => {
  await fetch(apiUrl() + "/api/health");
});
`,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "this run fails inside the case for want of that setting");
  assert.match(
    failure,
    new RegExp(`read E2E_API_URL, which AUTH_LAYOUT_SUITE declares neither`),
    "a setting a `return` reaches is as undeclared as one an assignment reaches",
  );
});

test("a fixture reads settings on behalf of the spec importing it", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
const secretKey = process.env.CLERK_SECRET_KEY;
export const test = base.extend({ secretKey: [secretKey, { option: true }] });
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "a fixture's module scope runs as the spec is collected");
  assert.match(failure, /CLERK_SECRET_KEY/);
  assert.match(
    failure,
    /auth-layout\.fixture\.ts/,
    "the fixture is where a reader has to go to see why",
  );
});

test("a fixture renamed out from under the spec importing it is reported", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["CLERK_SECRET_KEY"] },
    `import { test } from "./auth-layout.fixture";
test("signs in", async () => {});
`,
    {
      // The fixture under the name it has now. The spec above still imports
      // the one it had before: Playwright fails that run as it collects the
      // spec, and every setting the fixture reads is missing from what this
      // suite is seen to read — which the comparison the other way would
      // report as a `required` entry nothing needs any more.
      [e2e("auth-layout.signed-in.fixture.ts")]:
        `import { test as base } from "@playwright/test";
const secretKey = process.env.CLERK_SECRET_KEY;
export const test = base.extend({ secretKey: [secretKey, { option: true }] });
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "a spec importing a file that is not there cannot load");
  assert.match(
    failure,
    /auth-layout-visual\.spec\.ts: imports \.\/auth-layout\.fixture/,
    "the report should name the module writing the import and the specifier as written",
  );
  assert.match(
    failure,
    new RegExp(`nothing here is at ${DECLARATION_DIR}/auth-layout\\.fixture`),
    "and where nothing was found for it, which is what a reader corrects",
  );
  assert.doesNotMatch(
    failure,
    new RegExp(`drop CLERK_SECRET_KEY from .${REQUIRED_KEY}.`),
    "that setting is read in the file that went missing, so dropping it would break the run the import is fixed",
  );
});

test("a setting the suite states as optional is accepted", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"], optional: ["E2E_API_URL"] },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("mentions the API where it is configured", async () => {
  const api = process.env["E2E_API_URL"] ?? "the API";
  await Promise.resolve(api);
});
`,
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a run that really may go without a setting says so rather than asking for it",
  );
});

test("an optional setting nothing reads is a waiver held open", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"], optional: ["E2E_API_URL"] },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "it only widens what the suite may silently skip");
  assert.match(failure, /E2E_API_URL/);
  assert.match(failure, new RegExp(`states E2E_API_URL as .${OPTIONAL_KEY}.`));
});

test("an optional entry is read for the name beside its line", (t) => {
  const root = settingsWorkspace(
    t,
    {
      required: ["E2E_CHAT_URL"],
      // Written out rather than generated: what this reads is the shape the
      // shared module states, a name beside the line the run prints with it.
      optionalExpression: `[{ ${OPTIONAL_NAME_KEY}: "E2E_API_URL", ${OPTIONAL_LINE_KEY}: "the API is called by name, not by address" }]`,
    },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("mentions the API where it is configured", async () => {
  await Promise.resolve(process.env["E2E_API_URL"] ?? "the API");
});
`,
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "the line an entry carries is prose for the reader, not a second name",
  );
});

test("optional entries spread from another list are read through", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"], optionalExpression: "[...SWEEP_SETTINGS]" },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("sweeps first", async () => {
  await Promise.resolve(process.env["ADMIN_USER_IDS"] ?? "");
});
`,
    {},
    `const SWEEP_SETTINGS = [{ ${OPTIONAL_NAME_KEY}: "ADMIN_USER_IDS", ${OPTIONAL_LINE_KEY}: "the sweep spares fewer accounts" }];`,
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a shared list of entries is declared once and stated by every suite running it",
  );
});

test("an optional entry naming nothing readable holds the suite to nothing", (t) => {
  const root = settingsWorkspace(
    t,
    {
      required: ["E2E_CHAT_URL"],
      optionalExpression: `[{ ${OPTIONAL_NAME_KEY}: settingFor(process.platform), ${OPTIONAL_LINE_KEY}: "less" }]`,
    },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "an entry nothing can read states no setting at all");
  assert.match(failure, /settingFor\(process\.platform\)/);
});

/**
 * A spec reading the setting its suite states as optional, so what these
 * cases are about is the entry's line and not whether anything reads it.
 */
const READS_THE_API = `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("mentions the API where it is configured", async () => {
  await Promise.resolve(process.env["E2E_API_URL"] ?? "the API");
});
`;

/** How the report names an entry that says nothing about going without it. */
const saysNothing = (name: string): RegExp =>
  new RegExp(
    `states ${name} as .${OPTIONAL_KEY}. with no .${OPTIONAL_LINE_KEY}. line`,
  );

test("an optional entry with a blank line is refused", (t) => {
  const root = settingsWorkspace(
    t,
    {
      required: ["E2E_CHAT_URL"],
      optionalExpression: `[{ ${OPTIONAL_NAME_KEY}: "E2E_API_URL", ${OPTIONAL_LINE_KEY}: "" }]`,
    },
    READS_THE_API,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "an empty line prints the bare name it was to replace");
  assert.match(
    failure,
    saysNothing("E2E_API_URL"),
    "the report should name the suite and the setting it left unexplained",
  );
  assert.match(
    failure,
    new RegExp(
      `fix: write what these cases do without E2E_API_URL as the .${OPTIONAL_LINE_KEY}.`,
    ),
    "and say what to write, as the other problems here do",
  );
});

test("an optional entry stating nothing but a name is refused", (t) => {
  const root = settingsWorkspace(
    t,
    {
      required: ["E2E_CHAT_URL"],
      optionalExpression: `[{ ${OPTIONAL_NAME_KEY}: "E2E_API_URL" }]`,
    },
    READS_THE_API,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "the entry the line was added to is the entry with none");
  assert.match(failure, saysNothing("E2E_API_URL"));
});

test("a line of nothing but spaces is no line", (t) => {
  const root = settingsWorkspace(
    t,
    {
      required: ["E2E_CHAT_URL"],
      optionalExpression: `[{ ${OPTIONAL_NAME_KEY}: "E2E_API_URL", ${OPTIONAL_LINE_KEY}: "   " }]`,
    },
    READS_THE_API,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "whitespace announces exactly what nothing announces");
  assert.match(failure, saysNothing("E2E_API_URL"));
});

test("a blank line in a shared list of entries is refused too", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"], optionalExpression: "[...SWEEP_SETTINGS]" },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("sweeps first", async () => {
  await Promise.resolve(process.env["ADMIN_USER_IDS"] ?? "");
});
`,
    {},
    `const SWEEP_SETTINGS = [{ ${OPTIONAL_NAME_KEY}: "ADMIN_USER_IDS", ${OPTIONAL_LINE_KEY}: "" }];`,
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a list stated by several suites leaves each of their runs saying nothing",
  );
  assert.match(failure, saysNothing("ADMIN_USER_IDS"));
});

/**
 * The split a suite states in `unused`, in miniature: one fixture creating
 * accounts, which is all this suite's cases need, and one building the
 * signed-in pages on top of it, which is where the app's URL is read.
 */
const ACCOUNTS_FIXTURE = `import { test as base } from "@playwright/test";
const secretKey = process.env.CLERK_SECRET_KEY;
export const test = base.extend({ secretKey: [secretKey, { option: true }] });
`;

const PAGES_FIXTURE = `import { test as accounts } from "./accounts.fixture";
const chatUrl = process.env["E2E_CHAT_URL"];
export const test = accounts.extend({ chatUrl: [chatUrl, { option: true }] });
`;

const SPLIT_FIXTURES = {
  [e2e("accounts.fixture.ts")]: ACCOUNTS_FIXTURE,
  [e2e("pages.fixture.ts")]: PAGES_FIXTURE,
};

/** A suite needing the accounts alone, stating the other half's setting. */
const OPENS_NO_PAGE: Partial<SuiteSpec> = {
  required: ["CLERK_SECRET_KEY"],
  unused: ["E2E_CHAT_URL"],
};

test("a suite importing only the half it needs states the other's setting and passes", (t) => {
  const root = settingsWorkspace(
    t,
    OPENS_NO_PAGE,
    `import { test } from "./accounts.fixture";
test("creates an account and opens no page", async () => {});
`,
    SPLIT_FIXTURES,
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "the module reading that setting is on disk and out of this spec's imports, which is the whole of what the entry claims",
  );
});

test("a module bringing that setting back is named, and not answered with a list", (t) => {
  const root = settingsWorkspace(
    t,
    OPENS_NO_PAGE,
    // The import this suite was split to avoid, made again.
    `import { test } from "./pages.fixture";
test("opens a page after all", async () => {});
`,
    SPLIT_FIXTURES,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "the imports reach the read the suite says they do not");
  assert.match(
    failure,
    new RegExp(`AUTH_LAYOUT_SUITE states E2E_CHAT_URL as .${UNUSED_KEY}.`),
  );
  assert.match(
    failure,
    /E2E_CHAT_URL is read in: .*pages\.fixture\.ts/,
    "the module that reintroduced it is the one to keep out of those imports",
  );
  assert.doesNotMatch(
    failure,
    new RegExp(`add E2E_CHAT_URL to .${REQUIRED_KEY}.`),
    "declaring it is what this entry refuses, so it cannot be what the report advises",
  );
});

test("the config reading it reaches this suite's cases too", (t) => {
  const root = settingsWorkspace(
    t,
    OPENS_NO_PAGE,
    `import { test } from "./accounts.fixture";
test("opens no page", async () => {});
`,
    {
      ...SPLIT_FIXTURES,
      [e2e("playwright.auth-layout.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./auth-layout.requirement.ts",
  use: { baseURL: process.env["E2E_CHAT_URL"] },
`,
        "auth-layout-visual.spec.ts",
      ),
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a baseURL every case is handed is this suite reading the app's URL",
  );
  assert.match(failure, new RegExp(`states E2E_CHAT_URL as .${UNUSED_KEY}.`));
  assert.match(
    failure,
    /E2E_CHAT_URL is read in: .*playwright\.auth-layout\.config\.ts/,
    "the config is the module to keep that read out of, so it is the one named",
  );
});

test("a module bringing it back after a keyword is named just the same", (t) => {
  const root = settingsWorkspace(
    t,
    OPENS_NO_PAGE,
    `import { test } from "./pages.fixture";
test("opens a page after all", async () => {});
`,
    {
      ...SPLIT_FIXTURES,
      // The half this suite was split from, reading the app's URL inside a
      // function rather than at its module scope.
      [e2e("pages.fixture.ts")]:
        `import { test as accounts } from "./accounts.fixture";
export function chatUrl(): string {
  return process.env["E2E_CHAT_URL"] ?? "";
}
export const test = accounts;
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "where a read is written is no answer to a suite stating it never reaches that setting",
  );
  assert.match(
    failure,
    new RegExp(`AUTH_LAYOUT_SUITE states E2E_CHAT_URL as .${UNUSED_KEY}.`),
  );
  assert.match(
    failure,
    /E2E_CHAT_URL is read in: .*pages\.fixture\.ts/,
    "the module that reintroduced it is still the one to keep out of those imports",
  );
});

test("stating it as optional as well does not settle the read", (t) => {
  const root = settingsWorkspace(
    t,
    // What the failure above is quickest to answer with: the import stays,
    // and one entry makes the complaint go away -- at the price of every run
    // of this suite announcing a gap that is not one.
    { ...OPENS_NO_PAGE, optional: ["E2E_CHAT_URL"] },
    `import { test } from "./pages.fixture";
test("opens a page after all", async () => {});
`,
    SPLIT_FIXTURES,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "the suite now says both things about the same setting");
  assert.match(
    failure,
    new RegExp(
      `states E2E_CHAT_URL as .${UNUSED_KEY}. and asks for it in .${REQUIRED_KEY}. or .${OPTIONAL_KEY}.`,
    ),
    "the report should say which two lines disagree, since either could be the one to go",
  );
});

test("an unused entry naming nothing readable holds the suite to nothing", (t) => {
  const root = settingsWorkspace(
    t,
    {
      required: ["E2E_CHAT_URL"],
      unusedExpression: `[{ ${OPTIONAL_NAME_KEY}: settingFor(process.platform), why: "some other suite's" }]`,
    },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "an entry nothing can read refuses no setting at all");
  assert.match(failure, /settingFor\(process\.platform\)/);
  assert.match(failure, new RegExp(`${UNUSED_KEY}: \\{`));
});

test("an unused entry naming a setting nothing here reads protects nothing", (t) => {
  const root = settingsWorkspace(
    t,
    // The split above, with the name mistyped in the entry recording it.
    // Everything else is as it was: the module reading the real setting is
    // still there, still out of these imports, and still unrefused.
    { required: ["CLERK_SECRET_KEY"], unused: ["E2E_CHAT_UR"] },
    `import { test } from "./accounts.fixture";
test("creates an account and opens no page", async () => {});
`,
    SPLIT_FIXTURES,
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "no import could bring a read of a setting nothing here has, so the entry refuses nothing",
  );
  assert.match(
    failure,
    new RegExp(`AUTH_LAYOUT_SUITE states E2E_CHAT_UR as .${UNUSED_KEY}.`),
  );
  assert.match(
    failure,
    /the entry protects nothing/,
    "which is the thing to say: the line reads as a rule whether or not it holds anybody to anything",
  );
});

test("a setting read in a package nothing here imports is still this workspace's", (t) => {
  const root = settingsWorkspace(
    t,
    OPENS_NO_PAGE,
    `import { test } from "./accounts.fixture";
test("creates an account and opens no page", async () => {});
`,
    {
      [e2e("accounts.fixture.ts")]: ACCOUNTS_FIXTURE,
      // The half this suite was split from, moved out of the suites'
      // directory into a package of its own that no suite imports today.
      // One import of it is all it would take, which is the read the entry
      // is there to refuse.
      "lib/chat-pages/src/index.ts": `export function chatUrl(): string {
  return process.env["E2E_CHAT_URL"] ?? "";
}
`,
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "what the entry refuses is a read this workspace can still make, wherever the module making it sits",
  );
});

test("a setting another suite asks for is one this entry can still refuse", (t) => {
  const root = workspace(t, {
    suites: [
      { ...AUTH_LAYOUT_DECLARATION, ...OPENS_NO_PAGE },
      {
        name: "LAUNCH_SMOKE_SUITE",
        config: "playwright.launch-smoke.config.ts",
        spec: "launch-smoke.spec.ts",
        required: ["E2E_CHAT_URL"],
      },
    ],
    files: {
      [e2e("playwright.auth-layout.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./auth-layout.requirement.ts",\n`,
        "auth-layout-visual.spec.ts",
      ),
      [e2e("auth-layout.requirement.ts")]: requirement("AUTH_LAYOUT_SUITE"),
      [e2e("auth-layout-visual.spec.ts")]:
        `import { test } from "./accounts.fixture";
test("creates an account and opens no page", async () => {});
`,
      [e2e("accounts.fixture.ts")]: ACCOUNTS_FIXTURE,
      [e2e("playwright.launch-smoke.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./launch-smoke.requirement.ts",\n`,
        "launch-smoke.spec.ts",
      ),
      [e2e("launch-smoke.requirement.ts")]: requirement("LAUNCH_SMOKE_SUITE"),
      // The suite that opens the app, with the read of its URL gone from
      // everything it runs: a stale `required` entry, which is that suite's
      // to answer.
      [e2e("launch-smoke.spec.ts")]: `import { test } from "@playwright/test";
test("opens the app", async () => {});
`,
    },
  });

  assert.equal(
    inspectConfig(root, e2e("playwright.auth-layout.config.ts")),
    null,
    "a setting a suite here still asks for is one an import could bring back, whatever became of the module reading it",
  );
  assert.match(
    checkWorkspace(root) ?? "",
    /LAUNCH_SMOKE_SUITE requires E2E_CHAT_URL, and nothing this config runs reads it/,
    "the stale entry is the one fault here, and it belongs to the suite that wrote it",
  );
});

test("a config reading a setting its suite never asked for fails", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "@playwright/test";
test("a case", async () => {});
`,
    {
      [e2e("playwright.auth-layout.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./auth-layout.requirement.ts",
  use: { baseURL: process.env["E2E_CHAT_URL"] },
  reporter: [["json", { outputFile: process.env["E2E_REPORT_FILE"] }]],
`,
        "auth-layout-visual.spec.ts",
      ),
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "nothing stops this run once, naming what it is missing");
  assert.match(
    failure,
    /playwright\.auth-layout\.config\.ts\n/,
    "the config is the file a reader has to open, so it is the one named",
  );
  assert.match(
    failure,
    /reads E2E_REPORT_FILE as Playwright loads it, which AUTH_LAYOUT_SUITE declares neither/,
    "the report should name the setting and the suite that does not ask for it",
  );
  assert.match(
    failure,
    new RegExp(`never stopped by ${GLOBAL_SETUP_KEY}`),
    "which is what makes this worse than the same read inside a case",
  );
  assert.match(
    failure,
    /E2E_REPORT_FILE is read in: .*playwright\.auth-layout\.config\.ts/,
  );
});

test("a config reading after a keyword is read as Playwright loading it", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "@playwright/test";
test("a case", async () => {});
`,
    {
      // The read above, moved into a function, which is where a config
      // picking its reporter file out of the environment tends to keep it.
      [e2e("playwright.auth-layout.config.ts")]:
        `import { defineConfig } from "@playwright/test";
function reportPath(): string {
  return process.env["E2E_REPORT_FILE"] ?? "report.json";
}
export default defineConfig({
  testDir: ".",
  ${TEST_MATCH_KEY}: /auth-layout-visual\\.spec\\.ts/,
  ${GLOBAL_SETUP_KEY}: "./auth-layout.requirement.ts",
  use: { baseURL: process.env["E2E_CHAT_URL"] },
  reporter: [["json", { outputFile: reportPath() }]],
});
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a config reaches a setting through a `return` as surely as through an entry it writes",
  );
  assert.match(
    failure,
    /reads E2E_REPORT_FILE as Playwright loads it, which AUTH_LAYOUT_SUITE declares neither/,
    "the report should name the setting and the suite that does not ask for it",
  );
  assert.match(
    failure,
    /E2E_REPORT_FILE is read in: .*playwright\.auth-layout\.config\.ts/,
    "the config is the file to open, wherever in it that read is written",
  );
});

test("what a config imports is read on the config's behalf", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "@playwright/test";
test("a case", async () => {});
`,
    {
      [e2e("playwright.auth-layout.config.ts")]:
        `import { defineConfig } from "@playwright/test";
import { reportPath } from "./report-path.ts";
export default defineConfig({
  testDir: ".",
  ${TEST_MATCH_KEY}: /auth-layout-visual\\.spec\\.ts/,
  ${GLOBAL_SETUP_KEY}: "./auth-layout.requirement.ts",
  use: { baseURL: process.env["E2E_CHAT_URL"] },
  reporter: [["json", { outputFile: reportPath() }]],
});
`,
      [e2e("report-path.ts")]: `const configured = process.env["E2E_REPORT_FILE"];
export function reportPath() {
  return configured ?? "report.json";
}
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a config reaches a setting through its imports as a spec does",
  );
  assert.match(
    failure,
    /E2E_REPORT_FILE is read in: .*report-path\.ts/,
    "the helper is where a reader has to go to see why the run needs it",
  );
});

test("a setting only the config reads is this suite's, both ways", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"], optional: ["E2E_REPORT_FILE"] },
    `import { test } from "@playwright/test";
test("a case", async () => {});
`,
    {
      [e2e("playwright.auth-layout.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./auth-layout.requirement.ts",
  use: { baseURL: process.env["E2E_CHAT_URL"] },
  reporter: [["json", { outputFile: process.env["E2E_REPORT_FILE"] ?? "report.json" }]],
`,
        "auth-layout-visual.spec.ts",
      ),
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a declaration the config reads is a live one, not a stale one to drop",
  );
});

test("the module deciding whether the run may start is read too", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
    {
      [e2e("auth-layout.requirement.ts")]:
        `import { ${ANNOUNCE_FUNCTION}, AUTH_LAYOUT_SUITE } from "${REQUIREMENT_PACKAGE}";
export default function setup(): void {
  ${ANNOUNCE_FUNCTION}(AUTH_LAYOUT_SUITE);
  if (!process.env["E2E_MODERATOR_PASSWORD"]) throw new Error("no moderator");
}
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a config names this module as a string path, so no import leads to it and nothing else reads it",
  );
  assert.match(
    failure,
    new RegExp(
      `${GLOBAL_SETUP_KEY} module reads E2E_MODERATOR_PASSWORD, which AUTH_LAYOUT_SUITE declares neither`,
    ),
    "the report should name the setting and the suite that does not ask for it",
  );
  assert.match(
    failure,
    /E2E_MODERATOR_PASSWORD is read in: .*auth-layout\.requirement\.ts/,
    "and the module holding the read, which is the one a reader opens",
  );
});

test("a setting only that module reads is this suite's, both ways", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL", "E2E_MODERATOR_PASSWORD"] },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
    {
      [e2e("auth-layout.requirement.ts")]:
        `import { ${ANNOUNCE_FUNCTION}, AUTH_LAYOUT_SUITE } from "${REQUIREMENT_PACKAGE}";
export default function setup(): void {
  ${ANNOUNCE_FUNCTION}(AUTH_LAYOUT_SUITE);
  if (!process.env["E2E_MODERATOR_PASSWORD"]) throw new Error("no moderator");
}
`,
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "the reverse comparison would otherwise call a setting this run really stops for a stale entry",
  );
});

/**
 * The announcement as the shared library writes it: it reads the suite's own
 * settings off the environment it is handed, by names built from that
 * declaration as it goes.
 */
const ANNOUNCE_READING_ENVIRONMENT = `export function ${ANNOUNCE_FUNCTION}(
  suite: ${SUITE_TYPE},
  env: Record<string, string | undefined> = process.env,
): void {
  for (const name of suite.${REQUIRED_KEY}) {
    if (!(env[name] ?? "").trim()) throw new Error(name);
  }
}`;

test("the environment handed to the announcement is not a gap", (t) => {
  const root = workspace(t, {
    suites: [{ ...AUTH_LAYOUT_DECLARATION, required: ["E2E_CHAT_URL"] }],
    announce: ANNOUNCE_READING_ENVIRONMENT,
    files: {
      [e2e("playwright.auth-layout.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./auth-layout.requirement.ts",\n`,
        "auth-layout-visual.spec.ts",
      ),
      [e2e("auth-layout-visual.spec.ts")]:
        `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
      [e2e("auth-layout.requirement.ts")]:
        `import { ${ANNOUNCE_FUNCTION}, AUTH_LAYOUT_SUITE } from "${REQUIREMENT_PACKAGE}";
export default function setup(): void {
  ${ANNOUNCE_FUNCTION}(AUTH_LAYOUT_SUITE, { ...process.env, BROWSER_TESTS: "required" });
}
`,
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "what that call reads off the environment is the declaration this check is comparing against, so following it only reports its own reader",
  );
});

test("the environment reaching anywhere else in that module still is", (t) => {
  const root = workspace(t, {
    suites: [{ ...AUTH_LAYOUT_DECLARATION, required: ["E2E_CHAT_URL"] }],
    announce: ANNOUNCE_READING_ENVIRONMENT,
    files: {
      [e2e("playwright.auth-layout.config.ts")]: config(
        `  ${GLOBAL_SETUP_KEY}: "./auth-layout.requirement.ts",\n`,
        "auth-layout-visual.spec.ts",
      ),
      [e2e("auth-layout-visual.spec.ts")]:
        `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
      [e2e("auth-layout.requirement.ts")]:
        `import { ${ANNOUNCE_FUNCTION}, AUTH_LAYOUT_SUITE } from "${REQUIREMENT_PACKAGE}";
import { assertDevelopment } from "./development.ts";
export default function setup(): void {
  ${ANNOUNCE_FUNCTION}(AUTH_LAYOUT_SUITE, { ...process.env, BROWSER_TESTS: "required" });
  assertDevelopment(process.env);
}
`,
      [e2e("development.ts")]:
        `export function assertDevelopment(env: Record<string, string | undefined>): void {
  if (env.E2E_MODERATOR_PASSWORD === undefined) throw new Error("no moderator");
}
`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "only the announcement's own environment argument is passed over",
  );
  assert.match(
    failure,
    /E2E_MODERATOR_PASSWORD is read in: .*development\.ts/,
    "a helper this module hands the environment to is followed as any other is",
  );
});

/** A workspace package of the shape `@workspace/db` has, as files on disk. */
function packageFiles(
  name: string,
  dir: string,
  modules: Record<string, string>,
  exported: Record<string, unknown> = { ".": "./src/index.ts" },
): Record<string, string> {
  const files: Record<string, string> = {
    [`${dir}/package.json`]: `${JSON.stringify({ name, exports: exported }, null, 2)}\n`,
  };
  for (const [relative, source] of Object.entries(modules)) {
    files[`${dir}/${relative}`] = source;
  }
  return files;
}

test("regex escaping treats backslashes and metacharacters literally", () => {
  const value = String.raw`dir\file.[spec]/child`;
  const escaped = new RegExp(`^${escapeRegExp(value)}$`);

  assert.equal(escaped.test(value), true);
  assert.equal(escaped.test(`${value}extra`), false);
});

/** What names those directories as this workspace's own packages. */
const workspaceManifest = (globs: readonly string[]): string =>
  ["packages:", ...globs.map((glob) => `  - ${glob}`), ""].join("\n");

/** A spec that reaches its database through the package below. */
const SPEC_IMPORTING_DB = `import { test } from "@playwright/test";
import { db } from "@workspace/db";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("reads its rows back", async () => { await Promise.resolve(db); });
`;

/** That package, reading the connection at its own module scope. */
const DB_PACKAGE = {
  "pnpm-workspace.yaml": workspaceManifest(["lib/*"]),
  ...packageFiles("@workspace/db", "lib/db", {
    "src/index.ts": `export const db = { url: process.env.DATABASE_URL };\n`,
  }),
};

test("a setting read inside a workspace package is read by the suite", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL", "DATABASE_URL"] },
    SPEC_IMPORTING_DB,
    DB_PACKAGE,
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "the package takes DATABASE_URL out of the environment as this spec loads, so asking for it is not over-asking",
  );
});

test("a workspace package's read the suite never declared is reported", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    SPEC_IMPORTING_DB,
    DB_PACKAGE,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "this run starts and then fails as the spec is loaded");
  assert.match(failure, /DATABASE_URL/);
  assert.match(
    failure,
    /DATABASE_URL is read in: lib\/db\/src\/index\.ts/,
    "the package module is where a reader has to go to see why",
  );
});

test("a workspace package reading after a keyword is read for the suite too", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    SPEC_IMPORTING_DB,
    {
      "pnpm-workspace.yaml": workspaceManifest(["lib/*"]),
      // The package above, handing the connection back out of a function
      // rather than taking it at its module scope.
      ...packageFiles("@workspace/db", "lib/db", {
        "src/index.ts": `export function db(): string | undefined {
  return process.env.DATABASE_URL;
}
`,
      }),
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "this run starts and then fails as the spec loads the package, as it would for a read at that package's module scope",
  );
  assert.match(
    failure,
    /DATABASE_URL is read in: lib\/db\/src\/index\.ts/,
    "the package module is still the one to open, wherever in it the read is written",
  );
});

test("a workspace package subpath is followed where its exports say", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL", "DATABASE_URL"] },
    `import { test } from "@playwright/test";
import { usersTable } from "@workspace/db/schema";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("reads a table", async () => { await Promise.resolve(usersTable); });
`,
    {
      "pnpm-workspace.yaml": workspaceManifest(["lib/*"]),
      ...packageFiles(
        "@workspace/db",
        "lib/db",
        {
          // The entry point this spec never imports, so the setting below is
          // only reached by resolving the subpath it does import.
          "src/index.ts": `export const db = {};\n`,
          "src/schema/index.ts": `export const usersTable = process.env.DATABASE_URL;\n`,
        },
        { ".": "./src/index.ts", "./schema": "./src/schema/index.ts" },
      ),
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a subpath names a module of that package as surely as its entry point does",
  );
});

test("every wildcard in an exports target is substituted", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL", "DATABASE_URL"] },
    `import { test } from "@playwright/test";
import { usersTable } from "@workspace/db/schema/users";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("reads a table", async () => { await Promise.resolve(usersTable); });
`,
    {
      "pnpm-workspace.yaml": workspaceManifest(["lib/*"]),
      ...packageFiles(
        "@workspace/db",
        "lib/db",
        {
          "src/users/schema-users.ts": `export const usersTable = process.env.DATABASE_URL;\n`,
        },
        { ".": "./src/index.ts", "./schema/*": "./src/*/schema-*.ts" },
      ),
    },
  );

  assert.equal(checkWorkspace(root), null);
});

test("a directory of modules is read through the index inside it", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL", "DATABASE_URL"] },
    SPEC_IMPORTING_DB,
    {
      "pnpm-workspace.yaml": workspaceManifest(["lib/*"]),
      ...packageFiles("@workspace/db", "lib/db", {
        // The entry point names the directory beside it rather than a file
        // in it, which is how a schema split across modules is imported as
        // one — and how this package really writes it.
        "src/index.ts": `export * from "./schema";\nexport const db = {};\n`,
        "src/schema/index.ts": `export const usersTable = process.env.DATABASE_URL;\n`,
      }),
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a directory named as a module is the index inside it, and its reads are this suite's",
  );
});

test("a package this workspace does not build is not read for the suite", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "@playwright/test";
import { keys } from "@vendor/keys";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => { await Promise.resolve(keys); });
`,
    {
      // pnpm-workspace.yaml names lib/ and nothing else, so the package below
      // is a dependency like any other: what it takes out of the environment
      // is its own business, not a setting this suite is held to.
      "pnpm-workspace.yaml": workspaceManifest(["lib/*"]),
      ...packageFiles("@vendor/keys", "vendor/keys", {
        "src/index.ts": `export const keys = process.env.VENDOR_API_KEY;\n`,
      }),
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a dependency's own settings are not ones this suite forgot to declare",
  );
});

test("a package whose manifest names no file is reported, not read as fewer settings", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL", "DATABASE_URL"] },
    SPEC_IMPORTING_DB,
    {
      "pnpm-workspace.yaml": workspaceManifest(["lib/*"]),
      ...packageFiles(
        "@workspace/db",
        "lib/db",
        { "src/index.ts": `export const db = { url: process.env.DATABASE_URL };\n` },
        // Built output, which a checkout does not carry: the source beside it
        // reads DATABASE_URL, and nothing here can see that it does.
        { ".": "./dist/index.js" },
      ),
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "a package nothing can reach takes its reads with it");
  assert.match(
    failure,
    /auth-layout-visual\.spec\.ts: imports @workspace\/db/,
    "the report should name the file writing the import and the package it names",
  );
  assert.match(
    failure,
    /@workspace\/db names \.\/dist\/index\.js for its own entry point, and there is no such file in lib\/db/,
    "and say what the manifest points at, which is what a reader has to correct",
  );
  assert.doesNotMatch(
    failure,
    new RegExp(`drop DATABASE_URL from .${REQUIRED_KEY}.`),
    "following that advice would break the run this check exists to protect",
  );
});

test("a subpath no exports entry covers is reported as its own problem", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL", "DATABASE_URL"] },
    `import { test } from "@playwright/test";
import { usersTable } from "@workspace/db/schema";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("reads a table", async () => { await Promise.resolve(usersTable); });
`,
    {
      "pnpm-workspace.yaml": workspaceManifest(["lib/*"]),
      ...packageFiles(
        "@workspace/db",
        "lib/db",
        {
          "src/index.ts": `export const db = {};\n`,
          "src/schema/index.ts": `export const usersTable = process.env.DATABASE_URL;\n`,
        },
        { ".": "./src/index.ts" },
      ),
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "a subpath the manifest does not account for reads nothing");
  assert.match(
    failure,
    /@workspace\/db declares no `exports` entry covering \.\/schema/,
    "the report should name the package and the subpath it does not cover",
  );
  assert.doesNotMatch(
    failure,
    new RegExp(`drop DATABASE_URL from .${REQUIRED_KEY}.`),
    "the setting is read inside that subpath, which is exactly what went unread",
  );
});

test("an exports condition this check does not read is reported", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL", "DATABASE_URL"] },
    SPEC_IMPORTING_DB,
    {
      "pnpm-workspace.yaml": workspaceManifest(["lib/*"]),
      ...packageFiles(
        "@workspace/db",
        "lib/db",
        { "src/index.ts": `export const db = { url: process.env.DATABASE_URL };\n` },
        // A declaration file states the shape of a module, not what it takes
        // out of the environment, so this check does not read `types`.
        { ".": { types: "./src/index.d.ts" } },
      ),
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "a condition nothing here reads names no module to read");
  assert.match(
    failure,
    /@workspace\/db declares an `exports` entry for its own entry point naming no target under the conditions this check reads/,
    "the report should say which conditions were looked for, since `types` is not one",
  );
  assert.doesNotMatch(
    failure,
    new RegExp(`drop DATABASE_URL from .${REQUIRED_KEY}.`),
  );
});

test("a required setting nothing the suite runs reads fails", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL", "DATABASE_URL"] },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "it stops a run over a setting nothing here needs");
  assert.match(
    failure,
    /AUTH_LAYOUT_SUITE requires DATABASE_URL, and nothing this config runs reads it/,
    "the report should name the suite and the one entry to drop, not the one its cases do read",
  );
  assert.match(failure, new RegExp(`drop DATABASE_URL from .${REQUIRED_KEY}.`));
});

test("a required setting read only after a keyword is not an entry to drop", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "@playwright/test";
function chatUrl(): string {
  return process.env["E2E_CHAT_URL"] ?? "";
}
test("opens the app", async ({ page }) => {
  await page.goto(chatUrl());
});
`,
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "the reverse comparison would otherwise advise dropping the one setting this run cannot start without",
  );
});

test("a settings list this check cannot read holds the suite to nothing", (t) => {
  const root = settingsWorkspace(
    t,
    { requiredExpression: "settingsFor(process.platform)" },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a list nothing can see is not a list anything is held to",
  );
  assert.match(failure, /not written as plain names/);
  assert.match(failure, /settingsFor\(process\.platform\)/);
});

test("a list spread from another one is read through to its names", (t) => {
  const root = settingsWorkspace(
    t,
    { requiredExpression: `[...ROUTED_URL_VARS, "CLERK_SECRET_KEY"]` },
    `import { test } from "@playwright/test";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {
  await Promise.resolve([process.env["E2E_API_URL"], process.env.CLERK_SECRET_KEY]);
});
`,
    {},
    `const ROUTED_URL_VARS = ["E2E_CHAT_URL", "E2E_API_URL"] as const;`,
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a suite may name its settings through a shared list, as this one does",
  );
});

test("a commented-out read is not a read, and a destructured one is", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "@playwright/test";
const { E2E_API_URL } = process.env;
// const secretKey = process.env.CLERK_SECRET_KEY;
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => { await Promise.resolve(E2E_API_URL); });
`,
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "destructuring process.env is reading it");
  assert.match(failure, /E2E_API_URL/);
  assert.doesNotMatch(
    failure,
    /CLERK_SECRET_KEY/,
    "a read left behind in a comment is not one",
  );
});

test("every way of naming a setting is read, and nothing else is", () => {
  const uses = readEnvironmentUses(
    `const url = process.env["E2E_CHAT_URL"];
const key = process.env.CLERK_SECRET_KEY;
const { E2E_MODERATOR_EMAIL, E2E_MODERATOR_PASSWORD: password } = process.env;
const { ...rest } = process.env;
const literal = "DATABASE_URL";
const sentence = "process.env.MODERATORS is what a comment would say";
`,
  );

  assert.deepEqual(
    uses.names,
    [
      "CLERK_SECRET_KEY",
      "E2E_CHAT_URL",
      "E2E_MODERATOR_EMAIL",
      "E2E_MODERATOR_PASSWORD",
    ],
    "a name only mentioned inside a string is not a read this check can attribute",
  );
  assert.deepEqual(uses.unreadable, [], "every use here says what it reads");
});

test("a keyword in front of a read is not a name the read belongs to", () => {
  const uses = readEnvironmentUses(
    `function chatUrl() {
  return process.env["E2E_CHAT_URL"];
}
const configured = typeof process.env.E2E_API_URL;
async function secretKey() {
  return await process.env.CLERK_SECRET_KEY;
}
switch (stage) {
  case process.env.MODERATION_TIMEOUT_RECORD:
    break;
}
// return process.env.DATABASE_URL;
const sentence = "return process.env.SESSION_SECRET is what a comment would say";
const lowercase = stage
process.env;
`,
  );

  assert.deepEqual(
    uses.names,
    [
      "CLERK_SECRET_KEY",
      "E2E_API_URL",
      "E2E_CHAT_URL",
      "MODERATION_TIMEOUT_RECORD",
    ],
    "a keyword is not the name a read belongs to, and a name ending in one's letters is a name",
  );
  assert.deepEqual(
    uses.unreadable,
    [],
    "the statement after that name is nobody's read, so nothing here reaches the environment unreadably",
  );
});

test("an env another object holds is still not this environment", () => {
  const uses = readEnvironmentUses(
    `const stubbed = harness.process.env.E2E_CHAT_URL;
const spawned = child.process.env["CLERK_SECRET_KEY"];
const named = myprocess.env.DATABASE_URL;
const read = process.env.E2E_API_URL;
`,
  );

  assert.deepEqual(
    uses.names,
    ["E2E_API_URL"],
    "taking the keywords in front of a read leaves the `.` in front of one alone, so an `env` another object holds is that object's",
  );
  assert.deepEqual(
    uses.unreadable,
    [],
    "none of those is this environment reached in a way that cannot be followed",
  );
});

test("a name built while the case runs is not a name this check can read", () => {
  const uses = readEnvironmentUses(
    `const chosen = process.env[settingFor(process.platform)];
const { [alias]: aliased } = process.env;
const url = process.env["E2E_CHAT_URL"];
`,
  );

  assert.deepEqual(
    uses.names,
    ["E2E_CHAT_URL"],
    "only the read written out in full names a setting",
  );
  assert.deepEqual(
    uses.unreadable.map((use) => use.reason),
    [
      "the name it reads is built while the case runs, so which setting that is cannot be read from this file",
      "[alias]: aliased takes a key this check cannot read as a plain name",
    ],
    "both ways of reading an unnamed setting are reported rather than read as nothing",
  );
});

test("handing the environment on whole is a handoff, not a name", () => {
  const uses = readEnvironmentUses(
    `assertDevelopment(process.env);
recoverDisposables({ journal, env: process.env, currentRun });
`,
  );

  assert.deepEqual(
    uses.names,
    [],
    "neither call names a setting; what they read is in the functions they name",
  );
  assert.deepEqual(
    uses.handoffs.map(({ callee, argument, property }) => ({
      callee,
      argument,
      property,
    })),
    [
      { callee: "assertDevelopment", argument: 0, property: null },
      { callee: "recoverDisposables", argument: 0, property: "env" },
    ],
    "each handoff names the function to follow and where the environment lands in it",
  );
});

/** A fixture calling one helper with the whole environment, however it does. */
function handingOn(call: string, imports: string): string {
  return `import { test as base } from "@playwright/test";
${imports}
${call}
export const test = base;
`;
}

test("a helper handed the whole environment reads for the suite that runs it", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]: handingOn(
        "assertDevelopment(process.env);",
        `import { assertDevelopment } from "./development.mjs";`,
      ),
      [e2e("development.mjs")]: `export function assertDevelopment(env) {
  if (!env.CLERK_SECRET_KEY?.startsWith("sk_test_") || env.NODE_ENV === "production") {
    throw Error("These cases only run against a development instance");
  }
}
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a setting the helper reads is as missing at run time as one read in the fixture",
  );
  assert.match(failure, /read CLERK_SECRET_KEY, NODE_ENV/);
  assert.match(
    failure,
    /CLERK_SECRET_KEY is read in: .*development\.mjs/,
    "the helper is where a reader has to go to see why the suite needs it",
  );
});

test("the environment handed on inside an option is followed, and on again", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test("cleans up first", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]: handingOn(
        "void recover({ journal: null, env: process.env });",
        `import { recover } from "./recovery.mjs";`,
      ),
      [e2e("recovery.mjs")]: `import { assertDevelopment } from "./development.mjs";
export async function recover({ journal, env, now = Date.now() }) {
  assertDevelopment(env);
  const excluded = (env.ADMIN_USER_IDS ?? "").split(",");
  return [journal, now, excluded];
}
`,
      [e2e("development.mjs")]: `export function assertDevelopment(env) {
  if (env.REPLIT_DEPLOYMENT === "1") throw Error("Not against a deployment");
}
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "the option is the same handoff, written another way");
  assert.match(failure, /read ADMIN_USER_IDS, REPLIT_DEPLOYMENT/);
  assert.match(
    failure,
    /REPLIT_DEPLOYMENT is read in: .*development\.mjs/,
    "a helper's own handoff is followed too, or the chain stops one call short",
  );
});

test("a suite declaring what its helpers read passes", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"], optional: ["ADMIN_USER_IDS"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("cleans up first", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]: handingOn(
        "void recover({ env: process.env });",
        `import { recover } from "./recovery.mjs";`,
      ),
      [e2e("recovery.mjs")]: `export async function recover({ env }) {
  return (env.ADMIN_USER_IDS ?? "").split(",");
}
`,
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a setting only a helper reads is declared the same way as one read here",
  );
});

test("a helper whose reads cannot be seen is reported, not passed over", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test("signs in", async () => {});
`,
    {
      // A dependency: what it reads is its own business, and this workspace
      // builds nothing it could be followed into.
      [e2e("auth-layout.fixture.ts")]: handingOn(
        "assertDevelopment(process.env);",
        `import { assertDevelopment } from "@clerk/testing/playwright";`,
      ),
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "settings nobody can see are out of reach of the list, which is this same gap",
  );
  assert.match(failure, /reach the environment in a place this check cannot follow/);
  assert.match(failure, /auth-layout\.fixture\.ts: assertDevelopment\(process\.env\)/);
  assert.match(failure, /which this workspace does not build/);
});

/** A fixture handing the whole environment to a helper a shared library exports. */
const HANDING_ON_TO_A_PACKAGE = handingOn(
  "assertDevelopment(process.env);",
  `import { assertDevelopment } from "@workspace/e2e-support";`,
);

/** That library, declaring the helper in the module its `exports` names. */
const HELPER_PACKAGE = {
  "pnpm-workspace.yaml": workspaceManifest(["lib/*"]),
  ...packageFiles("@workspace/e2e-support", "lib/e2e-support", {
    "src/index.ts": `export function assertDevelopment(env: NodeJS.ProcessEnv): void {
  if (!env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw Error("These cases only run against a development instance");
  }
}
`,
  }),
};

test("a helper a workspace package exports reads for the suite that runs it", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]: HANDING_ON_TO_A_PACKAGE,
      ...HELPER_PACKAGE,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a shared library's helper reads the environment as surely as one beside the fixture",
  );
  assert.match(failure, /read CLERK_SECRET_KEY/);
  assert.match(
    failure,
    /CLERK_SECRET_KEY is read in: lib\/e2e-support\/src\/index\.ts/,
    "the package module is where a reader has to go to see why the suite needs it",
  );
  assert.doesNotMatch(
    failure,
    /outside this workspace/,
    "a package this repository builds is not outside it",
  );
});

test("a suite declaring what a workspace package's helper reads passes", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL", "CLERK_SECRET_KEY"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]: HANDING_ON_TO_A_PACKAGE,
      ...HELPER_PACKAGE,
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a setting only a shared helper reads is declared the same way as one read here",
  );
});

/** The helper itself, in whichever file of a library declares it. */
const DECLARED_HELPER = `export function assertDevelopment(env: NodeJS.ProcessEnv): void {
  if (!env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw Error("These cases only run against a development instance");
  }
}
`;

/** A library whose entry point only passes the helper on, written this way. */
const passingHelperAlong = (
  entry: string,
  declared: Record<string, string> = { "src/development.ts": DECLARED_HELPER },
): Record<string, string> => ({
  "pnpm-workspace.yaml": workspaceManifest(["lib/*"]),
  ...packageFiles("@workspace/e2e-support", "lib/e2e-support", {
    "src/index.ts": entry,
    ...declared,
  }),
});

test("a helper an entry point re-exports is followed to the file declaring it", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]: HANDING_ON_TO_A_PACKAGE,
      // The module its `exports` names passes the helper on from another file
      // rather than declaring it, which is the shape of a barrel entry point.
      ...passingHelperAlong(
        `export { assertDevelopment } from "./development";\n`,
      ),
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a helper reached through a re-export reads settings nothing holds the suite to",
  );
  assert.match(failure, /read CLERK_SECRET_KEY/);
  assert.match(
    failure,
    /CLERK_SECRET_KEY is read in: lib\/e2e-support\/src\/development\.ts/,
    "the file declaring it is where a reader goes, not the one passing it along",
  );
  assert.doesNotMatch(
    failure,
    /does not declare assertDevelopment/,
    "an entry point re-exporting a helper is the library's shape, not a fault",
  );
});

test("a suite declaring what a re-exported helper reads passes", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL", "CLERK_SECRET_KEY"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]: HANDING_ON_TO_A_PACKAGE,
      // The same passing on, written as an import and an export clause beside
      // it, which is the other way a barrel entry point is written.
      ...passingHelperAlong(
        `import { assertDevelopment } from "./development";
export { assertDevelopment };
`,
      ),
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a setting read past a re-export is declared the same way as one read here",
  );
});

test("a package passing every name on with `export *` is reported at that file", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]: HANDING_ON_TO_A_PACKAGE,
      ...passingHelperAlong(`export * from "./development";\n`),
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a shape this check cannot follow leaves the helper's reads unseen",
  );
  assert.match(
    failure,
    /auth-layout\.fixture\.ts: assertDevelopment\(process\.env\)/,
  );
  assert.match(
    failure,
    /lib\/e2e-support\/src\/index\.ts passes names on with `export \*`/,
    "the reason names the file it stopped at and the shape that stopped it",
  );
  assert.doesNotMatch(
    failure,
    /outside this workspace/,
    "the package was followed into; it is the shape of the export that stopped this",
  );
});

test("a helper renamed along a longer chain than this check reads is reported", (t) => {
  // Each file passes the next one's export on under a new name, so the chain
  // is followed by the name each module exports rather than by the one the
  // fixture calls, and it runs on past what this check reads.
  const steps = 6;
  const chain: Record<string, string> = {
    [`src/step${steps}.ts`]: DECLARED_HELPER.replace(
      "assertDevelopment",
      `helper${steps}`,
    ),
  };
  for (let step = 1; step < steps; step += 1) {
    chain[`src/step${step}.ts`] =
      `export { helper${step + 1} as helper${step} } from "./step${step + 1}";\n`;
  }

  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]: HANDING_ON_TO_A_PACKAGE,
      ...passingHelperAlong(
        `export { helper1 as assertDevelopment } from "./step1";\n`,
        chain,
      ),
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a chain this check gives up on hides what the helper reads",
  );
  assert.match(
    failure,
    /lib\/e2e-support\/src\/step5\.ts passes helper5 on again, past the 5 re-exports this check follows/,
    "the reason names the file it stopped at and the name it was following",
  );
});

test("a followed module reading a computed name is reported, not counted as no read", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL", "E2E_API_URL"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
const chosen = process.argv[2] ?? "E2E_API_URL";
export const api = process.env[chosen];
export const test = base;
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(failure, "a setting with no name here is one nothing can attribute");
  assert.match(
    failure,
    /auth-layout\.fixture\.ts: export const api = process\.env\[chosen\];/,
    "the report should point at the line, which is where a reader fixes it",
  );
  assert.match(failure, /the name it reads is built while the case runs/);
  assert.doesNotMatch(
    failure,
    new RegExp(`drop E2E_API_URL from .${REQUIRED_KEY}.`),
    "that read is what this suite requires E2E_API_URL for, unnamed though it is",
  );
});

test("a parameter's own default is not a handoff from anybody", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
export function waived(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[process.argv[2] ?? ""] === "skip";
}
export const test = base;
`,
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "whether that default is ever taken is a question about who calls it, not about this file",
  );
});

test("a name the environment is stored under is read as the environment", () => {
  const uses = readEnvironmentUses(
    `const env = process.env;
const chatUrl = env["E2E_CHAT_URL"];
const { E2E_API_URL } = env;
assertDevelopment(env);
recoverDisposables({ journal, env, currentRun });
`,
  );

  assert.deepEqual(
    uses.names,
    ["E2E_API_URL", "E2E_CHAT_URL"],
    "a name read off the stored environment is read off the environment",
  );
  assert.deepEqual(
    uses.handoffs.map(({ callee, argument, property }) => ({
      callee,
      argument,
      property,
    })),
    [
      { callee: "assertDevelopment", argument: 0, property: null },
      { callee: "recoverDisposables", argument: 0, property: "env" },
    ],
    "handing that name on is the same handoff as handing process.env on",
  );
  assert.deepEqual(
    uses.unreadable,
    [],
    "storing the environment first is not a place this check cannot follow",
  );
});

test("a fixture storing the environment first reaches the same settings", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
import { assertDevelopment } from "./development.mjs";
const env = process.env;
const secretKey = env["CLERK_SECRET_KEY"];
assertDevelopment(env);
export const test = base;
`,
      [e2e("development.mjs")]: `export function assertDevelopment(env) {
  if (env.NODE_ENV === "production") {
    throw Error("These cases only run against a development instance");
  }
}
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "the same settings are reached whichever way the environment got there",
  );
  assert.match(failure, /read CLERK_SECRET_KEY, NODE_ENV/);
  assert.match(
    failure,
    /CLERK_SECRET_KEY is read in: .*auth-layout\.fixture\.ts/,
    "a name read off the stored environment is read where it is written",
  );
  assert.match(
    failure,
    /NODE_ENV is read in: .*development\.mjs/,
    "a helper handed that name is followed as one handed process.env is",
  );
  assert.doesNotMatch(
    failure,
    /hand the whole environment on/,
    "an ordinary refactor of a fixture is not a limit of this check to report",
  );
});

test("a suite declaring what the stored environment reaches passes", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"], optional: ["ADMIN_USER_IDS"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("cleans up first", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
import { recover } from "./recovery.mjs";
const environment = process.env;
void recover({ journal: null, env: environment });
export const test = base;
`,
      [e2e("recovery.mjs")]:
        `export async function recover({ journal, env }) {
  return [journal, (env.ADMIN_USER_IDS ?? "").split(",")];
}
`,
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a setting reached through a local name is declared the same way as any other",
  );
});

test("a name given another value as well is reported, not read on", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
import { overrides } from "./overrides.mjs";
let env = process.env;
env = overrides();
export const secretKey = env["CLERK_SECRET_KEY"];
export const test = base;
`,
      [e2e("overrides.mjs")]: `export function overrides() {
  return { CLERK_SECRET_KEY: "sk_test_stand_in" };
}
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "what that name holds after being reassigned is not what this check followed",
  );
  assert.match(failure, /auth-layout\.fixture\.ts: env = overrides\(\);/);
  assert.match(failure, /given another value here/);
});

test("the environment exported under another name is reported, not followed", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("a case", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
export const env = process.env;
export const test = base;
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "what another module reads off that name is out of reach of this suite's list",
  );
  assert.match(failure, /auth-layout\.fixture\.ts: export const env = process\.env;/);
  assert.match(failure, /env leaves this module/);
});

test("spreading the environment into a call hands it on, wherever it came from", () => {
  const uses = readEnvironmentUses(
    `announce(SUITE, { ...process.env, BROWSER_TESTS: "1" });
const env = process.env;
helper({ ...env });
// elsewhere({ ...process.env });
const sentence = "{ ...process.env } is what a comment would say";
`,
  );

  assert.deepEqual(
    uses.names,
    [],
    "a spread names no setting; what it reaches is in the functions it is given to",
  );
  assert.deepEqual(
    uses.handoffs.map(({ callee, argument, property }) => ({
      callee,
      argument,
      property,
    })),
    [
      { callee: "announce", argument: 1, property: null },
      { callee: "helper", argument: 0, property: null },
    ],
    "an object spread from the environment arrives as that call's argument",
  );
  assert.deepEqual(
    uses.unreadable,
    [],
    "a spread inside a string is not a use, and neither is the name a declaration introduces nor the `env` of `process.env`",
  );
});

test("the environment spread where nothing can follow it is reported, not passed over", () => {
  const uses = readEnvironmentUses(
    `const fixture = { settings: { ...process.env } };
const mixed = { ...defaults, ...process.env };
export const shared = { ...process.env };
assertDevelopment(...process.env);
`,
  );

  assert.deepEqual(uses.names, [], "no spread here names a setting");
  assert.deepEqual(uses.handoffs, [], "none reaches a parameter to read");
  assert.deepEqual(
    uses.unreadable.map((use) => use.reason),
    [
      "it is put into an object this check cannot follow to a call",
      "mixed is built from more than the environment, so which of what it holds came from there cannot be read from here",
      "shared leaves this module, and what other files read off it cannot be seen from here",
      "it is spread across assertDevelopment's arguments, so which parameter it arrives at cannot be read from here",
    ],
    "a spread this check cannot follow is the same gap as any other, and silence over it is the one this check exists to close",
  );
  assert.deepEqual(
    uses.unreadable.map((use) => use.spread),
    [true, true, true, true],
    "every one of them hands the whole environment on",
  );
});

test("a gap carries whether the whole environment was handed on by a spread", () => {
  const uses = readEnvironmentUses(
    `recover({ options: { env: process.env } });
spawn(command, { env: { ...process.env, RECORD: record } });
`,
  );

  assert.deepEqual(
    uses.unreadable.map(({ reason, spread }) => ({ reason, spread })),
    [
      {
        reason: "it is put into an object this check cannot follow to a call",
        spread: false,
      },
      {
        reason: "it is put into an object this check cannot follow to a call",
        spread: true,
      },
    ],
    "the same gap, and only the second hands on everything the environment holds — which is what a caller declaring where it goes can account for",
  );
});

test("the environment collected into a name is handed on wherever that name goes", () => {
  const uses = readEnvironmentUses(
    `const settings = { ...process.env, BROWSER_TESTS: "1" };
announce(SUITE, settings);
const passedOn = { ...settings };
recover({ journal: null, env: passedOn });
const chatUrl = settings["E2E_CHAT_URL"];
`,
  );

  assert.deepEqual(
    uses.names,
    ["E2E_CHAT_URL"],
    "a name read off the collected settings is read off the environment",
  );
  assert.deepEqual(
    uses.handoffs.map(({ callee, argument, property }) => ({
      callee,
      argument,
      property,
    })),
    [
      { callee: "announce", argument: 1, property: null },
      { callee: "recover", argument: 0, property: "env" },
    ],
    "handing that name on is the same handoff as spreading the environment into the call",
  );
  assert.deepEqual(
    uses.unreadable,
    [],
    "collecting the environment a step before the call is not a place this check cannot follow",
  );
});

test("the environment kept under a key of a name is handed on under that key", () => {
  const uses = readEnvironmentUses(
    `const options = { env: process.env, now: Date.now() };
void recover(options);
announce(SUITE, { ...options });
const secret = options.env.CLERK_SECRET_KEY;
const chatUrl = options["env"]["E2E_CHAT_URL"];
const admins = options?.env?.ADMIN_USER_IDS;
const started = options.now;
const { now } = options;
`,
  );

  assert.deepEqual(
    uses.names,
    ["ADMIN_USER_IDS", "CLERK_SECRET_KEY", "E2E_CHAT_URL"],
    "a setting read through the key the environment sits under is read off the environment, however that read is written",
  );
  assert.deepEqual(
    uses.handoffs.map(({ callee, argument, property }) => ({
      callee,
      argument,
      property,
    })),
    [
      { callee: "recover", argument: 0, property: "env" },
      { callee: "announce", argument: 1, property: "env" },
    ],
    "handing that name on is the handoff writing the same object in the call's own arguments already is",
  );
  assert.deepEqual(
    uses.unreadable,
    [],
    "another key of the same object reaches nothing of the environment, read or destructured, and neither is a gap",
  );
});

test("the environment taken out of a keyed name by a pattern is read on as the name it binds", () => {
  const uses = readEnvironmentUses(
    `const options = { env: process.env, now: Date.now() };
const { env, now } = options;
const secret = env.CLERK_SECRET_KEY;
assertDevelopment(env);
const { env: environment = {} } = options;
const chatUrl = environment["E2E_CHAT_URL"];
`,
  );

  assert.deepEqual(
    uses.names,
    ["CLERK_SECRET_KEY", "E2E_CHAT_URL"],
    "a setting read off the binding a pattern takes the key into is read off the environment, whether the pattern renames it or writes a default beside it",
  );
  assert.deepEqual(
    uses.handoffs.map(({ callee, argument, property }) => ({
      callee,
      argument,
      property,
    })),
    [{ callee: "assertDevelopment", argument: 0, property: null }],
    "handing that binding on is the same handoff as handing the environment itself on",
  );
  assert.deepEqual(
    uses.unreadable,
    [],
    "unpacking an options object is an ordinary way to write a fixture, not a place this check cannot follow",
  );
});

test("a keyed name is followed no further than the key can be read through", () => {
  const gaps = (code: string): string[] =>
    readEnvironmentUses(code).unreadable.map((use) => use.reason);

  assert.deepEqual(
    gaps(`const options = { env: process.env };
options.env = overrides();
`),
    [
      "options.env is given another value here, so what it holds from here on is not the environment",
    ],
    "what that key holds after being given a second value is not the environment",
  );
  assert.deepEqual(
    gaps(`const options = { env: process.env, [chosen]: fallback };
recover(options);
`),
    [
      "options holds a key this check cannot read as a plain name, so whether it is a second env cannot be read from here",
    ],
    "a key built while the case runs may be the one the environment was written under",
  );
  assert.deepEqual(
    gaps(`const options = { env: process.env, env: fallback };
recover(options);
`),
    [
      "options is given env more than once, so what it holds there cannot be read from here",
    ],
    "written twice, which of the two a call is handed is not this reading's to say",
  );
  assert.deepEqual(
    gaps(`const options = { ...defaults, env: process.env };
recover(options);
`),
    [
      "options is built from more than the keys written in it, so whether env still holds the environment where it is used cannot be read from here",
    ],
    "a second object spread in beside it may put something else under the same key",
  );
  assert.deepEqual(
    gaps(`export const options = { env: process.env };
`),
    [
      "options leaves this module, and what other files read off it cannot be seen from here",
    ],
    "a name other files reach is no more readable for holding the environment under a key",
  );
  assert.deepEqual(
    gaps(`const options = { env: process.env };
const settings = options[chosen];
`),
    [
      "the key it reads off options is built while the case runs, so whether that is the env it holds the environment under cannot be read from this file",
    ],
    "a key read while the case runs may be the one the environment sits under",
  );
  assert.deepEqual(
    gaps(`const options = { env: process.env, now: Date.now() };
const { now, ...rest } = options;
`),
    [
      "env is taken into the rest of options bound here, along with everything else that pattern does not name, which this check does not follow",
    ],
    "swept up with everything the pattern does not name, the environment is somewhere this reading stops",
  );
  assert.deepEqual(
    gaps(`const options = { env: process.env };
const { [chosen]: taken } = options;
`),
    [
      "[chosen]: taken takes a key this check cannot read as a plain name, so whether it is the env options holds the environment under cannot be read from here",
    ],
    "a key the pattern builds while the case runs may be the one the environment sits under",
  );
  assert.deepEqual(
    gaps(`const options = { env: process.env };
const { env, env: again } = options;
`),
    [
      "env is taken out of options into 2 bindings at once here, and this check follows it out of a pattern into one",
    ],
    "taken twice over, more names hold the environment than this reading follows out",
  );
  assert.deepEqual(
    gaps(`const options = { env: process.env };
export const { env } = options;
`),
    [
      "env leaves this module, and what other files read off it cannot be seen from here",
    ],
    "a binding taken out of a pattern is no more readable for leaving the module than any other name is",
  );
  assert.deepEqual(
    gaps(`const options = { env: process.env };
recover({ options });
`),
    [
      "options arrives at recover under options, so the environment it holds reaches options.env, which this check does not follow",
    ],
    "handed on under a further key, the environment is a level deeper than a parameter can be read at",
  );
  assert.deepEqual(
    gaps(`const options = { env: process.env };
const options = process.env;
`),
    [
      "options is given the environment under env and as itself, so which of them a use of it hands on cannot be read from here",
    ],
    "one name holding it two ways is a question about the order the file runs in, not one this reading answers",
  );
});

test("a name given another value as well is not read on from, however it was collected", () => {
  const uses = readEnvironmentUses(
    `let settings = { ...process.env };
settings = overrides();
`,
  );

  assert.deepEqual(
    uses.unreadable.map((use) => use.reason),
    [
      "settings is given another value here, so what it holds from here on is not the environment",
    ],
    "what that name holds after being given a second value is not what was collected into it",
  );
});

test("a fixture spreading the environment into a call is held to what that call reads", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]: handingOn(
        `assertDevelopment({ ...process.env, NODE_ENV: "test" });`,
        `import { assertDevelopment } from "./development.mjs";`,
      ),
      [e2e("development.mjs")]: `export function assertDevelopment(env) {
  if (!env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw Error("These cases only run against a development instance");
  }
}
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "spread into the call, the helper's reads are as missing at run time as if it had been handed the environment whole",
  );
  assert.match(failure, /read CLERK_SECRET_KEY/);
  assert.match(
    failure,
    /CLERK_SECRET_KEY is read in: .*development\.mjs/,
    "the helper is still where a reader has to go to see why the suite needs it",
  );
});

test("a fixture collecting the environment first is held to what it hands it to", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
import { assertDevelopment } from "./development.mjs";
const settings = { ...process.env, NODE_ENV: "test" };
assertDevelopment(settings);
export const test = base;
`,
      [e2e("development.mjs")]: `export function assertDevelopment(env) {
  if (!env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw Error("These cases only run against a development instance");
  }
}
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "collected a step before the call, the helper's reads are as missing at run time as if it had been handed the environment whole",
  );
  assert.match(failure, /read CLERK_SECRET_KEY/);
  assert.match(
    failure,
    /CLERK_SECRET_KEY is read in: .*development\.mjs/,
    "the helper is still where a reader has to go to see why the suite needs it",
  );
  assert.doesNotMatch(
    failure,
    /cannot follow to setting names/,
    "an ordinary way to write a fixture is not a limit of this check to report",
  );
});

test("a fixture keeping the environment under a key is held to what that key reaches", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
import { assertDevelopment } from "./development.mjs";
const options = { env: process.env, startedAt: Date.now() };
assertDevelopment(options);
export const test = base;
`,
      [e2e("development.mjs")]: `export function assertDevelopment({ env }) {
  if (!env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw Error("These cases only run against a development instance");
  }
}
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "kept under a key of an options object, the helper's reads are as missing at run time as if it had been handed the environment whole",
  );
  assert.match(failure, /read CLERK_SECRET_KEY/);
  assert.match(
    failure,
    /CLERK_SECRET_KEY is read in: .*development\.mjs/,
    "the helper is still where a reader has to go to see why the suite needs it",
  );
  assert.doesNotMatch(
    failure,
    /cannot follow to setting names/,
    "an ordinary way to write a fixture is not a limit of this check to report",
  );
});

test("a fixture unpacking its options is held to what the binding it takes reaches", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"] },
    `import { test } from "./auth-layout.fixture";
test("signs in", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
import { assertDevelopment } from "./development.mjs";
const options = { env: process.env, startedAt: Date.now() };
const { env } = options;
const secretKey = env["CLERK_SECRET_KEY"];
assertDevelopment(env);
export const test = base;
`,
      [e2e("development.mjs")]: `export function assertDevelopment(env) {
  if (env.NODE_ENV === "production") {
    throw Error("These cases only run against a development instance");
  }
}
`,
    },
  );

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "taken out of the options object into a binding of its own, the environment reaches the same settings it did under the key",
  );
  assert.match(failure, /read CLERK_SECRET_KEY, NODE_ENV/);
  assert.match(
    failure,
    /CLERK_SECRET_KEY is read in: .*auth-layout\.fixture\.ts/,
    "a name read off that binding is read where it is written",
  );
  assert.match(
    failure,
    /NODE_ENV is read in: .*development\.mjs/,
    "a helper handed that binding is followed as one handed process.env is",
  );
  assert.doesNotMatch(
    failure,
    /out of a pattern/,
    "destructuring an options object is an ordinary way to write a fixture, not a limit of this check to report",
  );
});

test("a suite declaring what a pattern takes out of its options reaches passes", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"], optional: ["ADMIN_USER_IDS"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("cleans up first", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
import { recover } from "./recovery.mjs";
const options = { env: process.env, now: Date.now() };
const { env: environment } = options;
void recover({ journal: null, env: environment });
export const test = base;
`,
      [e2e("recovery.mjs")]:
        `export async function recover({ journal, env }) {
  return [journal, (env.ADMIN_USER_IDS ?? "").split(",")];
}
`,
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a setting reached through a binding taken out of an options object is declared the same way as any other",
  );
});

test("a suite declaring what a keyed name reaches passes", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"], optional: ["ADMIN_USER_IDS"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("cleans up first", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
import { recover } from "./recovery.mjs";
const options = { env: process.env, now: Date.now() };
void recover(options);
export const test = base;
`,
      [e2e("recovery.mjs")]:
        `export async function recover({ env, now }) {
  return [(env.ADMIN_USER_IDS ?? "").split(","), now];
}
`,
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a setting reached through the key a name keeps the environment under is declared the same way as any other",
  );
});

test("a suite declaring what a collected name reaches passes", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"], optional: ["ADMIN_USER_IDS"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("cleans up first", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
import { recover } from "./recovery.mjs";
const settings = { ...process.env, BROWSER_TESTS: "1" };
void recover(settings);
export const test = base;
`,
      [e2e("recovery.mjs")]:
        `export async function recover({ ADMIN_USER_IDS }) {
  return (ADMIN_USER_IDS ?? "").split(",");
}
`,
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a setting reached through a collected name is declared the same way as any other",
  );
});

test("a suite declaring what a spread reaches passes", (t) => {
  const root = settingsWorkspace(
    t,
    { required: ["E2E_CHAT_URL"], optional: ["ADMIN_USER_IDS"] },
    `import { test } from "./auth-layout.fixture";
test.use({ baseURL: process.env["E2E_CHAT_URL"] });
test("cleans up first", async () => {});
`,
    {
      [e2e("auth-layout.fixture.ts")]:
        `import { test as base } from "@playwright/test";
import { recover } from "./recovery.mjs";
const environment = process.env;
void recover({ ...environment });
export const test = base;
`,
      [e2e("recovery.mjs")]:
        `export async function recover({ ADMIN_USER_IDS }) {
  return (ADMIN_USER_IDS ?? "").split(",");
}
`,
    },
  );

  assert.equal(
    checkWorkspace(root),
    null,
    "a setting reached through a spread is declared the same way as any other",
  );
});

test("this workspace's browser configs all announce their own suite", () => {
  assert.equal(
    checkWorkspace(WORKSPACE_ROOT),
    null,
    `every Playwright config in this workspace should decide its settings requirement in ${GLOBAL_SETUP_KEY}, announcing the suite declared for the spec it runs`,
  );
});

/**
 * The case above passes on the tree as a whole, and an `unused` entry's own
 * rule is the one it can pass without exercising: a setting another suite
 * asks for is answered from the declarations, before anything is read. So
 * the read side is asked for here as well, which is the half that would go
 * quiet if the search ever stopped reaching the modules these entries are
 * about.
 */
test("every unused entry here names a setting something in this workspace reads", () => {
  const stated = readWorkspaceDeclarations(WORKSPACE_ROOT).flatMap(
    (declaration) =>
      declaration.unused.map((name) => ({ suite: declaration.suite, name })),
  );
  assert.ok(
    stated.length > 0,
    `no suite in ${REQUIREMENT_MODULE} states a setting as \`${UNUSED_KEY}\` any more, so this case holds nothing to naming a real one — the rule it covers is in checkBrowserTestRequirements.ts, and goes when the last entry does`,
  );

  const readHere = settingsReadInWorkspace(WORKSPACE_ROOT);
  for (const entry of stated) {
    assert.ok(
      readHere.has(entry.name),
      `${entry.suite} states ${entry.name} as \`${UNUSED_KEY}\` in ${REQUIREMENT_MODULE}, and no module here reads it: either the name is mistyped or the code it was written about is gone, and the entry now refuses a read nothing could make`,
    );
  }
});

/**
 * Nothing above this point runs the check as a command: these cases import
 * the module, and an import never reaches the line that starts it. So the
 * whole suite can pass over a script that dies on startup, which is what
 * happened — the run was started from the middle of the module, and a helper
 * it reached read a `const` declared below that call, still in its temporal
 * dead zone. The command died with "Cannot access X before initialization"
 * instead of reporting the wiring problem it had found, and only for a tree
 * whose manifests took that branch, so neither this suite nor a review of the
 * change that introduced it had anything to fail on.
 *
 * Reading the module's own source is what is left: the ordering that makes
 * the crash possible is visible there whatever the tree looks like, where the
 * crash itself waits for a particular package to write its manifest the wrong
 * way.
 */
test("the check starts itself last, after every declaration a run reaches", () => {
  const code = stripComments(
    readFileSync(
      path.join(WORKSPACE_ROOT, "scripts/src/checkBrowserTestRequirements.ts"),
      "utf8",
    ),
  );

  const started = [...code.matchAll(/\bmain\s*\(\s*\)\s*;/g)];
  assert.equal(
    started.length,
    1,
    "the module starts its run in one place, the guard that runs it as a command",
  );

  const after = code.slice(started[0]!.index + started[0]![0].length);
  assert.match(
    after,
    /^\s*\}?\s*$/,
    `the run has to be the last statement in scripts/src/checkBrowserTestRequirements.ts, because everything declared after it is still in its temporal dead zone while the run is in progress; move this below the declarations rather than the declarations above it, and the command reports what it finds instead of dying on:\n${after.trim().slice(0, 200)}`,
  );
});
