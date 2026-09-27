import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
  DECLARATION_DIR,
  OPTIONAL_KEY,
  OPTIONAL_LINE_KEY,
  OPTIONAL_NAME_KEY,
  REQUIRED_KEY,
  REQUIREMENT_MODULE,
  REQUIREMENT_PACKAGE,
} from "../src/checkBrowserTestRequirements.ts";
import { SUITE_TYPE } from "../src/checkBrowserTestRequirements.ts";
import {
  checkWorkspace,
  COMMAND_KEY,
  COMMAND_TYPE,
  PREFLIGHT_FUNCTION,
  STARTS_KEY,
} from "../src/checkCommandRequirements.ts";

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** What the shared module says about one command someone runs by hand. */
interface CommandSpec {
  /** Export name, which is what the command's own preflight names. */
  name: string;
  /** The module it runs: a bare name, or a workspace-relative path. */
  module: string;
  /** Written verbatim as `command`, for a name nothing can read. */
  moduleExpression?: string;
  /** Settings the declaration says it cannot run without. */
  required?: readonly string[];
  /** Settings it states the command reads but may run without. */
  optional?: readonly string[];
  /** Written verbatim as the `required` entry, for one nothing can read. */
  requiredExpression?: string;
  /** Written verbatim as the `optional` entry, for one nothing can read. */
  optionalExpression?: string;
  /** What the module really reads; by default, exactly what it declares. */
  reads?: readonly string[];
  /** Export name of the browser run it declares it starts as a child. */
  starts?: string;
  /** Written verbatim as `starts`, for a run named as nothing readable. */
  startsExpression?: string;
  /** That module is written to disk unless this says otherwise. */
  onDisk?: boolean;
}

/** What the shared module says about one browser run a command starts. */
interface SuiteSpec {
  /** Export name, which is what a command's `starts` entry names. */
  name: string;
  /** The Playwright config that run is made from. */
  config: string;
  /** Settings that run cannot start without. */
  required?: readonly string[];
}

/** The run the timeout verifier starts: one case, in a child process. */
const TIMEOUT_SUITE: SuiteSpec = {
  name: "TIMEOUT_SUITE",
  config: "playwright.moderation-timeout.config.ts",
  required: ["DATABASE_URL"],
};

/** A command that starts a browser run, handed this environment whole. */
const TIMEOUT: CommandSpec = {
  name: "TIMEOUT_COMMAND",
  module: "moderation-timeout.verify.mjs",
  required: ["DATABASE_URL"],
  starts: TIMEOUT_SUITE.name,
};

/** Names written the way a settings list in the shared module writes them. */
const settingsList = (names: readonly string[]): string =>
  `[${names.map((name) => `"${name}"`).join(", ")}]`;

/**
 * An `optional` list as that module writes one: each entry states the name
 * and the line a suite prints for it, the same entries a command spreads in.
 */
const optionalList = (names: readonly string[]): string =>
  `[${names
    .map(
      (name) =>
        `{ ${OPTIONAL_NAME_KEY}: "${name}", ${OPTIONAL_LINE_KEY}: "the sweep carries on" }`,
    )
    .join(", ")}]`;

const RECOVERY: CommandSpec = {
  name: "RECOVERY_COMMAND",
  module: "moderation-recover.mjs",
  required: ["DATABASE_URL"],
};

/** The shared requirement module, declaring the commands a case needs. */
function sharedModule(
  commands: readonly CommandSpec[],
  suites: readonly SuiteSpec[] = [],
  lists: readonly string[] = [],
): string {
  return [
    `export interface ${SUITE_TYPE} {`,
    "  label: string;",
    "  config: string;",
    "  spec: string;",
    `  ${REQUIRED_KEY}: string[];`,
    "}",
    `export interface ${COMMAND_TYPE} {`,
    "  label: string;",
    `  ${COMMAND_KEY}: string;`,
    `  ${REQUIRED_KEY}: string[];`,
    `  ${OPTIONAL_KEY}?: { ${OPTIONAL_NAME_KEY}: string; ${OPTIONAL_LINE_KEY}: string }[];`,
    `  ${STARTS_KEY}?: ${SUITE_TYPE};`,
    "  does: string[];",
    "}",
    `export function ${PREFLIGHT_FUNCTION}(): boolean { return true; }`,
    // Entries a declaration below spreads rather than writing out, which is
    // how both real commands state the recovery sweep's settings.
    ...lists,
    ...suites.map((suite) =>
      [
        `export const ${suite.name}: ${SUITE_TYPE} = {`,
        `  label: "${suite.name}",`,
        `  config: "${suite.config}",`,
        `  spec: "${suite.config.replace("playwright.", "").replace(".config.ts", ".spec.ts")}",`,
        `  ${REQUIRED_KEY}: ${settingsList(suite.required ?? [])},`,
        "};",
      ].join("\n"),
    ),
    ...commands.map((command) =>
      [
        `export const ${command.name}: ${COMMAND_TYPE} = {`,
        `  label: "${command.name}",`,
        `  ${COMMAND_KEY}: ${command.moduleExpression ?? `"${command.module}"`},`,
        `  ${REQUIRED_KEY}: ${command.requiredExpression ?? settingsList(command.required ?? [])},`,
        ...(command.optionalExpression || command.optional
          ? [
              `  ${OPTIONAL_KEY}: ${command.optionalExpression ?? optionalList(command.optional ?? [])},`,
            ]
          : []),
        ...(command.startsExpression || command.starts
          ? [`  ${STARTS_KEY}: ${command.startsExpression ?? command.starts},`]
          : []),
        "  does: [],",
        "};",
      ].join("\n"),
    ),
    "",
  ].join("\n");
}

/**
 * A command of the shape the timeout verifier has: it asks, then starts a
 * Playwright run of its own, handed this environment whole.
 */
function startingCommandModule(
  spec: CommandSpec,
  config: string,
  reads: readonly string[] = spec.required ?? [],
): string {
  return `import { ${PREFLIGHT_FUNCTION}, ${spec.name} } from "${REQUIREMENT_PACKAGE}";
import { spawn } from "node:child_process";
if (!${PREFLIGHT_FUNCTION}(${spec.name})) process.exitCode = 1;
else {
${reads.map((name) => `  console.log(process.env.${name});`).join("\n")}
  spawn(process.execPath, ["cli.js", "test", "--config", "e2e/${config}"], {
    env: { ...process.env, MODERATION_TIMEOUT_RECORD: "/tmp/ids" },
    stdio: "ignore",
  });
}
`;
}

/** A command of the shape the recovery commands have: it asks, then runs. */
function commandModule(spec: CommandSpec): string {
  const reads = spec.reads ?? [...(spec.required ?? []), ...(spec.optional ?? [])];
  return `import { ${PREFLIGHT_FUNCTION}, ${spec.name} } from "${REQUIREMENT_PACKAGE}";
if (!${PREFLIGHT_FUNCTION}(${spec.name})) process.exitCode = 1;
else {
${reads.map((name) => `  console.log(process.env.${name});`).join("\n")}
}
`;
}

interface WorkspaceSpec {
  /** Files to write, workspace-relative path to contents. */
  files?: Record<string, string>;
  /** Commands the shared module declares; their modules are written too. */
  commands?: readonly CommandSpec[];
  /** Scripts the package these modules live in declares. */
  scripts?: Record<string, string>;
  /** Browser runs it declares beside them, for a command that starts one. */
  suites?: readonly SuiteSpec[];
  /** Settings lists that module declares, for a declaration spreading one. */
  lists?: readonly string[];
  /** The shared requirement module is written unless this says otherwise. */
  withRequirementModule?: boolean;
}

/** Shorthand for a file in the directory a bare declared name sits in. */
const e2e = (name: string): string => `${DECLARATION_DIR}/${name}`;

/** Where a declared name lands: bare names sit with the browser suites. */
const declared = (name: string): string =>
  name.includes("/") ? name : e2e(name);

/** The package whose directory holds those modules, and runs them. */
const DECLARATION_PACKAGE = path.posix.dirname(DECLARATION_DIR);

/** How a script in that package names one of them: its own working directory. */
const runs = (name: string): string =>
  path.posix.relative(DECLARATION_PACKAGE, declared(name));

/** The package globs a workspace manifest lists, as this repository's does. */
const WORKSPACE_MANIFEST = [
  "packages:",
  "  - artifacts/*",
  "  - lib/*",
  "  - scripts",
  "",
].join("\n");

/** A package.json, which is where a script that runs a command by hand is. */
const manifest = (
  name: string,
  scripts: Record<string, string> = {},
): string => `${JSON.stringify({ name, scripts }, null, 2)}\n`;

/** A throwaway workspace on disk, removed when the test ends. */
function workspace(t: TestContext, spec: WorkspaceSpec = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "command-requirement-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const commands = spec.commands ?? [RECOVERY];
  const files = { ...spec.files };
  if (spec.withRequirementModule !== false) {
    files[REQUIREMENT_MODULE] = sharedModule(commands, spec.suites, spec.lists);
  }
  for (const command of commands) {
    if (command.onDisk === false) continue;
    files[declared(command.module)] ??= commandModule(command);
  }
  // Which modules are commands is read from the package scripts, so a
  // workspace has the manifests those are declared in.
  files["pnpm-workspace.yaml"] ??= WORKSPACE_MANIFEST;
  files["package.json"] ??= manifest("workspace");
  if (spec.scripts) {
    files[`${DECLARATION_PACKAGE}/package.json`] ??= manifest(
      `@workspace/${path.posix.basename(DECLARATION_PACKAGE)}`,
      spec.scripts,
    );
  }
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

test("a command naming the settings it reads passes", (t) => {
  const root = workspace(t, {
    commands: [
      {
        ...RECOVERY,
        required: ["DATABASE_URL", "CLERK_SECRET_KEY"],
        optional: ["ADMIN_USER_IDS"],
      },
    ],
  });

  assert.equal(checkWorkspace(root), null);
});

test("a command that never asks whether it may run fails", (t) => {
  const root = workspace(t, {
    files: {
      [e2e("moderation-recover.mjs")]: `console.log(process.env.DATABASE_URL);\n`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "without the preflight a missing setting throws partway");
  assert.match(failure, /RECOVERY_COMMAND/);
  assert.match(failure, new RegExp(`never calls ${PREFLIGHT_FUNCTION}\\(\\)`));
});

test("a command that asks and drops the answer fails", (t) => {
  const root = workspace(t, {
    files: {
      [e2e("moderation-recover.mjs")]:
        `import { ${PREFLIGHT_FUNCTION}, RECOVERY_COMMAND } from "${REQUIREMENT_PACKAGE}";
${PREFLIGHT_FUNCTION}(RECOVERY_COMMAND);
console.log(process.env.DATABASE_URL);
`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "printing the refusal and deleting anyway is worse");
  assert.match(failure, /does nothing with the answer/);
});

test("a command held to another command's settings fails", (t) => {
  const other: CommandSpec = {
    name: "LIVE_COMMAND",
    module: "moderation-recovery.verify.mjs",
    required: ["MODERATION_RECOVERY_LIVE"],
  };
  const root = workspace(t, {
    commands: [RECOVERY, other],
    files: {
      [e2e("moderation-recover.mjs")]:
        `import { ${PREFLIGHT_FUNCTION}, ${other.name} } from "${REQUIREMENT_PACKAGE}";
if (!${PREFLIGHT_FUNCTION}(${other.name})) process.exitCode = 1;
else {
  console.log(process.env.DATABASE_URL);
}
`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "each command has to be held to its own settings");
  assert.match(failure, /holds itself to LIVE_COMMAND/);
});

test("a setting the command reads and declares neither way fails", (t) => {
  const root = workspace(t, {
    commands: [
      { ...RECOVERY, required: ["DATABASE_URL"], reads: ["DATABASE_URL", "E2E_MODERATOR_EMAIL"] },
    ],
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "an undeclared read is the throw this replaces, later");
  assert.match(failure, /reads E2E_MODERATOR_EMAIL/);
  assert.match(
    failure,
    /E2E_MODERATOR_EMAIL is read in: artifacts\/api-server\/e2e\/moderation-recover\.mjs/,
  );
});

test("a required setting nothing it runs reads any more fails", (t) => {
  const root = workspace(t, {
    commands: [
      { ...RECOVERY, required: ["DATABASE_URL", "E2E_CHAT_URL"], reads: ["DATABASE_URL"] },
    ],
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a stale entry refuses a run that would have worked");
  assert.match(failure, /requires E2E_CHAT_URL/);
});

test("an optional setting nothing it runs reads any more fails", (t) => {
  const root = workspace(t, {
    commands: [
      {
        ...RECOVERY,
        required: ["DATABASE_URL"],
        optional: ["ADMIN_USER_IDS"],
        reads: ["DATABASE_URL"],
      },
    ],
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "an optional entry nothing reads states nothing");
  assert.match(failure, new RegExp(`states ADMIN_USER_IDS as \`${OPTIONAL_KEY}\``));
});

/**
 * A command whose module reads the setting its declaration states as
 * optional, so what the cases below are about is the entry's line and not
 * whether anything reads the setting at all.
 */
const READS_THE_SWEEP_SETTING: CommandSpec = {
  ...RECOVERY,
  required: ["DATABASE_URL"],
  reads: ["DATABASE_URL", "ADMIN_USER_IDS"],
};

/** How the report names an entry saying nothing about going without it. */
const saysNothing = (name: string): RegExp =>
  new RegExp(
    `states ${name} as .${OPTIONAL_KEY}. with no .${OPTIONAL_LINE_KEY}. line`,
  );

test("an optional entry with a blank line is refused", (t) => {
  const root = workspace(t, {
    commands: [
      {
        ...READS_THE_SWEEP_SETTING,
        optionalExpression: `[{ ${OPTIONAL_NAME_KEY}: "ADMIN_USER_IDS", ${OPTIONAL_LINE_KEY}: "" }]`,
      },
    ],
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "an empty line states the bare name it was to replace");
  assert.match(
    failure,
    saysNothing("ADMIN_USER_IDS"),
    "the report should name the command and the setting it left unexplained",
  );
  assert.match(
    failure,
    new RegExp(`${RECOVERY.name} states ADMIN_USER_IDS`),
    "and say which command it is, these entries being read where they are declared",
  );
  assert.match(
    failure,
    new RegExp(
      `fix: write what this command does without ADMIN_USER_IDS as the .${OPTIONAL_LINE_KEY}.`,
    ),
    "and say what to write, as the other problems here do",
  );
});

test("an optional entry stating nothing but a name is refused", (t) => {
  const root = workspace(t, {
    commands: [
      {
        ...READS_THE_SWEEP_SETTING,
        optionalExpression: `[{ ${OPTIONAL_NAME_KEY}: "ADMIN_USER_IDS" }]`,
      },
    ],
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "the entry the line was added to is the entry with none");
  assert.match(failure, saysNothing("ADMIN_USER_IDS"));
});

test("a line of nothing but spaces is no line", (t) => {
  const root = workspace(t, {
    commands: [
      {
        ...READS_THE_SWEEP_SETTING,
        optionalExpression: `[{ ${OPTIONAL_NAME_KEY}: "ADMIN_USER_IDS", ${OPTIONAL_LINE_KEY}: "   " }]`,
      },
    ],
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "whitespace states exactly what nothing states");
  assert.match(failure, saysNothing("ADMIN_USER_IDS"));
});

test("a blank line in a list the declaration spreads is refused too", (t) => {
  const root = workspace(t, {
    commands: [
      {
        ...READS_THE_SWEEP_SETTING,
        optionalExpression: "[...RECOVERY_SWEEP_OPTIONAL]",
      },
    ],
    lists: [
      `const RECOVERY_SWEEP_OPTIONAL = [{ ${OPTIONAL_NAME_KEY}: "ADMIN_USER_IDS", ${OPTIONAL_LINE_KEY}: "" }];`,
    ],
  });

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "the list every command spreads is where a blank line would sit",
  );
  assert.match(failure, saysNothing("ADMIN_USER_IDS"));
});

test("a setting only a helper it hands the environment to reads is declared the same way", (t) => {
  const helper = `export function assertDevelopment(env) {
  if (!env.CLERK_SECRET_KEY) throw Error("development keys are required");
}
`;
  const module = `import { ${PREFLIGHT_FUNCTION}, RECOVERY_COMMAND } from "${REQUIREMENT_PACKAGE}";
import { assertDevelopment } from "./moderation-recovery.mjs";
if (!${PREFLIGHT_FUNCTION}(RECOVERY_COMMAND)) process.exitCode = 1;
else {
  assertDevelopment(process.env);
  console.log(process.env.DATABASE_URL);
}
`;
  const files = {
    [e2e("moderation-recovery.mjs")]: helper,
    [e2e("moderation-recover.mjs")]: module,
  };

  assert.equal(
    checkWorkspace(
      workspace(t, {
        commands: [{ ...RECOVERY, required: ["DATABASE_URL", "CLERK_SECRET_KEY"] }],
        files,
      }),
    ),
    null,
    "a setting a helper reads is the command's own to declare",
  );

  const failure = checkWorkspace(workspace(t, { files }));
  assert.ok(failure, "handing the environment on does not excuse declaring it");
  assert.match(failure, /reads CLERK_SECRET_KEY/);
});

test("a helper renamed out from under the command importing it is reported", (t) => {
  const root = workspace(t, {
    commands: [
      { ...RECOVERY, required: ["DATABASE_URL", "CLERK_SECRET_KEY"] },
    ],
    files: {
      // The helper under the name it has now. The command still imports the
      // one it had before: it stops as it loads, and the setting that helper
      // reads is missing from everything the command is seen to read — which
      // the comparison the other way would report as a `required` entry to
      // drop, on a command that cannot start at all.
      [e2e("moderation-disposables.mjs")]:
        `export const spared = process.env.CLERK_SECRET_KEY;\n`,
      [e2e(RECOVERY.module)]:
        `import { ${PREFLIGHT_FUNCTION}, ${RECOVERY.name} } from "${REQUIREMENT_PACKAGE}";
import { spared } from "./moderation-recovery.mjs";
if (!${PREFLIGHT_FUNCTION}(${RECOVERY.name})) process.exitCode = 1;
else {
  console.log(process.env.DATABASE_URL, spared);
}
`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a command importing a file that is not there cannot load");
  assert.match(
    failure,
    /moderation-recover\.mjs: imports \.\/moderation-recovery\.mjs/,
    "the report should name the module writing the import and the specifier as written",
  );
  assert.match(
    failure,
    new RegExp(`nothing here is at ${DECLARATION_DIR}/moderation-recovery\\.mjs`),
    "and where nothing was found for it, which is what a reader corrects",
  );
  assert.doesNotMatch(
    failure,
    new RegExp(`drop CLERK_SECRET_KEY from .${REQUIRED_KEY}.`),
    "that setting is read in the file that went missing, so dropping it would refuse the run once the import is fixed",
  );
});

test("a package whose manifest names no file is reported, not read as fewer settings", (t) => {
  const root = workspace(t, {
    // RECOVERY requires DATABASE_URL, and the only thing reading it is the
    // package below.
    files: {
      "lib/db/package.json": `${JSON.stringify(
        { name: "@workspace/db", exports: { ".": "./dist/index.js" } },
        null,
        2,
      )}\n`,
      // Built output, which a checkout does not carry: the source beside it
      // takes the connection out of the environment as this command loads,
      // and nothing here can see that it does.
      "lib/db/src/index.ts": `export const db = { url: process.env.DATABASE_URL };\n`,
      [e2e(RECOVERY.module)]:
        `import { ${PREFLIGHT_FUNCTION}, ${RECOVERY.name} } from "${REQUIREMENT_PACKAGE}";
import { db } from "@workspace/db";
if (!${PREFLIGHT_FUNCTION}(${RECOVERY.name})) process.exitCode = 1;
else {
  console.log(db.url);
}
`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a package nothing can reach takes its reads with it");
  assert.match(
    failure,
    /moderation-recover\.mjs: imports @workspace\/db/,
    "the report should name the module writing the import and the package it names",
  );
  assert.match(
    failure,
    /@workspace\/db names \.\/dist\/index\.js for its own entry point, and there is no such file in lib\/db/,
    "and say what the manifest points at, which is what a reader has to correct",
  );
  assert.doesNotMatch(
    failure,
    new RegExp(`drop DATABASE_URL from .${REQUIRED_KEY}.`),
    "following that advice would refuse nothing and break the recovery this command exists to run",
  );
});

test("an environment kept deeper in an object before the call is reported, not passed over", (t) => {
  const root = workspace(t, {
    files: {
      [e2e("moderation-recovery.mjs")]: `export async function recoverDisposables({ env }) {
  if (!env.ADMIN_USER_IDS) return 0;
  return 1;
}
`,
      [e2e("moderation-recover.mjs")]:
        `import { ${PREFLIGHT_FUNCTION}, RECOVERY_COMMAND } from "${REQUIREMENT_PACKAGE}";
import { recoverDisposables } from "./moderation-recovery.mjs";
if (!${PREFLIGHT_FUNCTION}(RECOVERY_COMMAND)) process.exitCode = 1;
else {
  const options = { defaults: { env: process.env } };
  await recoverDisposables(options.defaults);
  console.log(process.env.DATABASE_URL);
}
`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "settings nobody can see are out of reach of the list");
  assert.match(failure, /reaches the environment in a place this check cannot follow/);
  assert.match(
    failure,
    /moderation-recover\.mjs: const options = \{ defaults: \{ env: process\.env \} \};/,
  );
  assert.match(
    failure,
    /it is put into an object this check cannot follow/,
    "a key of a name's own object is followed to the call it is handed to; one written inside a further object is not",
  );
});

test("a command naming the browser run it starts passes", (t) => {
  const root = workspace(t, {
    commands: [TIMEOUT],
    suites: [TIMEOUT_SUITE],
    files: {
      [e2e(TIMEOUT.module)]: startingCommandModule(TIMEOUT, TIMEOUT_SUITE.config),
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "the run it hands the environment to declares its own settings, and this command requires them",
  );
});

test("a command starting a run it names nowhere fails", (t) => {
  const { starts: _starts, ...unstated } = TIMEOUT;
  const root = workspace(t, {
    commands: [unstated],
    files: {
      [e2e(TIMEOUT.module)]: startingCommandModule(unstated, TIMEOUT_SUITE.config),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "what a child process reads is read in no file this reaches");
  assert.match(failure, /reaches the environment in a place this check cannot follow/);
  assert.match(failure, /\.\.\.process\.env/);
});

test("a run named as something this check cannot read fails", (t) => {
  const root = workspace(t, {
    commands: [{ ...TIMEOUT, startsExpression: "suiteFor(process.platform)" }],
    suites: [TIMEOUT_SUITE],
    files: {
      [e2e(TIMEOUT.module)]: startingCommandModule(TIMEOUT, TIMEOUT_SUITE.config),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a run nothing can name states no settings");
  assert.match(failure, new RegExp(`\`${STARTS_KEY}\` is written as suiteFor\\(process\\.platform\\)`));
});

test("a run no declaration here states fails", (t) => {
  const root = workspace(t, {
    commands: [{ ...TIMEOUT, starts: "RETIRED_SUITE" }],
    suites: [TIMEOUT_SUITE],
    files: {
      [e2e(TIMEOUT.module)]: startingCommandModule(TIMEOUT, TIMEOUT_SUITE.config),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a renamed suite leaves the command accounting for nothing");
  assert.match(failure, /it states it starts RETIRED_SUITE/);
  assert.match(failure, new RegExp(`declares no ${SUITE_TYPE} by that name`));
});

test("a declared run the command's module never starts fails", (t) => {
  const root = workspace(t, {
    commands: [TIMEOUT],
    suites: [TIMEOUT_SUITE],
    files: {
      [e2e(TIMEOUT.module)]: startingCommandModule(
        TIMEOUT,
        "playwright.launch-smoke.config.ts",
      ),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "an environment spread into another run is accounted for by nothing");
  assert.match(failure, new RegExp(`nothing in .*${TIMEOUT.module.replace(/\./g, "\\.")} names ${TIMEOUT_SUITE.config.replace(/\./g, "\\.")}`));
});

test("a setting the run it starts needs and the command does not require fails", (t) => {
  const root = workspace(t, {
    commands: [TIMEOUT],
    suites: [{ ...TIMEOUT_SUITE, required: ["DATABASE_URL", "CLERK_SECRET_KEY"] }],
    files: {
      [e2e(TIMEOUT.module)]: startingCommandModule(TIMEOUT, TIMEOUT_SUITE.config),
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "the child run refuses where this command never printed why");
  assert.match(failure, /cannot start without CLERK_SECRET_KEY/);
});

test("a helper's own unreadable spread is reported even when the run is named", (t) => {
  const root = workspace(t, {
    commands: [TIMEOUT],
    suites: [TIMEOUT_SUITE],
    files: {
      [e2e("moderation-recovery.mjs")]: `export function recoverDisposables(env, overrides) {
  const settings = { ...env, ...overrides };
  return settings.ADMIN_USER_IDS ? 1 : 0;
}
`,
      [e2e(TIMEOUT.module)]: `import { ${PREFLIGHT_FUNCTION}, ${TIMEOUT.name} } from "${REQUIREMENT_PACKAGE}";
import { spawn } from "node:child_process";
import { recoverDisposables } from "./moderation-recovery.mjs";
if (!${PREFLIGHT_FUNCTION}(${TIMEOUT.name})) process.exitCode = 1;
else {
  console.log(process.env.DATABASE_URL);
  recoverDisposables(process.env, { retries: 3 });
  spawn(process.execPath, ["cli.js", "test", "--config", "e2e/${TIMEOUT_SUITE.config}"], {
    env: { ...process.env, MODERATION_TIMEOUT_RECORD: "/tmp/ids" },
  });
}
`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "naming the run it starts answers for that run, not for a helper");
  assert.match(failure, /moderation-recovery\.mjs/);
  assert.match(failure, /is built from more than the environment/);
});

test("a declaration naming no module fails", (t) => {
  const root = workspace(t, {
    commands: [
      { ...RECOVERY, moduleExpression: "`${DIRECTORY}/moderation-recover.mjs`" },
    ],
    files: { [e2e("moderation-recover.mjs")]: commandModule(RECOVERY) },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a command nothing can read is held to nothing");
  assert.match(failure, new RegExp(`\`${COMMAND_KEY}\` is not a plain module name`));
});

test("a declared module that is not there fails", (t) => {
  const root = workspace(t, { commands: [{ ...RECOVERY, onDisk: false }] });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a renamed module leaves the declaration holding nothing");
  assert.match(failure, /moderation-recover\.mjs.*is not there/);
});

test("settings written as something this check cannot read fail", (t) => {
  const root = workspace(t, {
    commands: [{ ...RECOVERY, requiredExpression: "settingsFor(process.platform)" }],
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "held to a list it cannot see, this would pass on nothing");
  assert.match(failure, /not written as plain names/);
});

test("an optional entry whose name is not a plain one fails", (t) => {
  const root = workspace(t, {
    commands: [
      {
        ...RECOVERY,
        optionalExpression: `[{ ${OPTIONAL_NAME_KEY}: sweepSetting(), without: "the sweep carries on" }]`,
      },
    ],
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "an entry naming nothing readable states no setting");
  assert.match(failure, /not written as plain names/);
  assert.match(failure, new RegExp(`${OPTIONAL_KEY}:`));
});

test("a package script running a module nothing declares fails", (t) => {
  const root = workspace(t, {
    scripts: {
      "e2e:moderation-sweep": `CLERK_TELEMETRY_DISABLED=1 node ${runs("moderation-sweep.mjs")}`,
    },
    files: {
      [e2e("moderation-sweep.mjs")]: `console.log(process.env.DATABASE_URL);\n`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a command nobody declared is held to no settings at all");
  assert.match(failure, /e2e:moderation-sweep/);
  assert.match(
    failure,
    /runs: artifacts\/api-server\/e2e\/moderation-sweep\.mjs/,
  );
  assert.match(failure, /no declaration names it/);
  assert.match(
    failure,
    new RegExp(`${COMMAND_KEY}: "moderation-sweep\\.mjs"`),
    "the fix names the declaration to write, in the form that module takes",
  );
});

test("a package script running a declared command passes", (t) => {
  const root = workspace(t, {
    scripts: {
      "e2e:moderation-recover": `CLERK_TELEMETRY_DISABLED=1 node ${runs(RECOVERY.module)}`,
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "the script is the evidence someone runs it, and this one is declared",
  );
});

test("a script in another package running one of these is still a command", (t) => {
  const other = "artifacts/support-tools";
  const root = workspace(t, {
    files: {
      [`${other}/package.json`]: manifest("@workspace/support-tools", {
        "e2e:moderation-sweep": `node ${path.posix.relative(other, e2e("moderation-sweep.mjs"))}`,
      }),
      [e2e("moderation-sweep.mjs")]: `console.log(process.env.DATABASE_URL);\n`,
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "where the script lives does not change what it runs");
  assert.match(failure, new RegExp(`${other}/package\\.json`));
});

test("the scripts that start a browser suite are not these commands", (t) => {
  const root = workspace(t, {
    scripts: {
      "test:e2e:banned-room":
        "playwright install chromium && playwright test --config e2e/playwright.config.ts",
      "test:e2e:moderation-timeout": `CLERK_TELEMETRY_DISABLED=1 node ${runs("moderation-timeout.verify.mjs")}`,
      "test:e2e:moderation-recovery": `node --test ${runs("moderation-recovery.test.mjs")}`,
    },
    files: {
      // Run to set up what a browser run records and then start it: the
      // settings its cases need are the suite's, named in the config it
      // starts and refused there before a spec loads.
      [e2e("moderation-timeout.verify.mjs")]:
        `import { spawnSync } from "node:child_process";
const run = spawnSync(process.execPath, [
  "node_modules/@playwright/test/cli.js",
  "test",
  "--config",
  "e2e/playwright.moderation.config.ts",
], { env: { ...process.env, PWTEST_SKIP: process.env.E2E_MODERATOR_PASSWORD } });
process.exitCode = run.status ?? 1;
`,
      // Handed to Node's own test runner by \`--test\`, so what the script
      // names is a suite that runner collects rather than a command.
      [e2e("moderation-recovery.test.mjs")]: `import test from "node:test";
test("the sweep deletes only what it made", () => {
  console.log(process.env.DATABASE_URL);
});
`,
      [e2e("playwright.moderation.config.ts")]: `export default {};\n`,
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "a browser suite declares its settings where the suite is declared",
  );
});

test("a script running a module outside that directory is not one of these", (t) => {
  const root = workspace(t, {
    scripts: { build: "node ./build.mjs" },
    files: {
      [`${DECLARATION_PACKAGE}/build.mjs`]: `console.log(process.env.NODE_ENV);\n`,
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "the commands these declarations hold are the ones in that directory",
  );
});

test("a shared module declaring no command fails", (t) => {
  const root = workspace(t, { commands: [] });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a check with nothing to check passes like a compliant one");
  assert.match(failure, new RegExp(`No ${COMMAND_TYPE} in ${REQUIREMENT_MODULE.replace(/[./]/g, "\\$&")} names a command`));
});

test("the shared requirement module being gone fails", (t) => {
  const root = workspace(t, { withRequirementModule: false });

  const failure = checkWorkspace(root);
  assert.ok(failure, "nothing declares these commands' settings without it");
  assert.match(failure, /is no longer there/);
});

test("this workspace's commands name the settings they read", () => {
  assert.equal(
    checkWorkspace(WORKSPACE_ROOT),
    null,
    `every ${COMMAND_TYPE} in this workspace should name the settings its command cannot run without, before that command touches an account`,
  );
});
