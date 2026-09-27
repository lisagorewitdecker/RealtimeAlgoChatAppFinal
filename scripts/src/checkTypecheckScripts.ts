/**
 * Workspace consistency check: every package script that runs `tsc` against a
 * project must run the root shared-library build first, and only continue when
 * that build succeeded.
 *
 * A package typechecks a workspace library through that library's generated
 * declarations in `lib/<name>/dist` (the libraries are composite project
 * references), not through the library's TypeScript source. `dist` is
 * gitignored, so a script that runs `tsc -p` on its own measures the package
 * against an absent or stale contract and reports errors the full
 * `pnpm run typecheck` never sees — `TS6305`, or the far more misleading
 * "Property 'x' does not exist" for a field the library plainly declares.
 *
 * Only the root `typecheck:libs` (`tsc --build` on the workspace root project)
 * rebuilds those declarations. A package-local `tsc --build` builds that
 * package's own project, and a build joined with `||` or `;` leaves the
 * typecheck running on stale output, so neither counts here.
 *
 * This file exists so the convention is enforced instead of remembered.
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Root script that builds every shared library (`tsc --build`). */
export const LIB_BUILD_SCRIPT = "typecheck:libs";

/** What a compliant script puts in front of its own `tsc` invocation. */
export const LIB_BUILD_PREFIX = `pnpm -w run ${LIB_BUILD_SCRIPT}`;

export interface WorkspacePackage {
  /** Workspace-relative directory, e.g. `artifacts/api-server`. */
  dir: string;
  /** Package name from package.json, or the directory when it has none. */
  name: string;
  scripts: Record<string, string>;
}

export type ViolationKind =
  /** No root library build runs before the typecheck. */
  | "missing"
  /** The root library build only runs after the typecheck. */
  | "out-of-order"
  /** A root library build runs first, but its success is not required. */
  | "unguarded";

export interface Violation {
  dir: string;
  name: string;
  script: string;
  command: string;
  kind: ViolationKind;
  /** Extra line explaining a near-miss, e.g. a package-local `tsc --build`. */
  hint?: string;
}

type Operator = "start" | "&&" | "||" | ";" | "|";

interface Segment {
  text: string;
  operatorBefore: Operator;
}

interface Token {
  value: string;
  quoted: boolean;
}

interface PackageContext {
  /** Absolute workspace root. */
  root: string;
  /** Absolute directory the package's scripts run from. */
  packageDir: string;
  /** The workspace root package can call `typecheck:libs` without `-w`. */
  isRootPackage: boolean;
}

type SegmentKind =
  /** The root shared-library build. */
  | { kind: "rootLibsBuild" }
  /** `tsc --build` of some project other than the workspace root. */
  | { kind: "localBuild" }
  /** `tsc` checking a project: `-p`, `--project`, or the current directory. */
  | { kind: "projectTypecheck" }
  /** `sh -c '<command>'` and friends: analyse the inner command. */
  | { kind: "nested"; command: string }
  | { kind: "other" };

/** Split a script into commands, keeping quoted text (`sh -c '...'`) intact. */
export function splitSegments(command: string): Segment[] {
  const segments: Segment[] = [];
  let text = "";
  let operatorBefore: Operator = "start";
  let quote: '"' | "'" | null = null;

  const push = (nextOperator: Operator): void => {
    segments.push({ text: text.trim(), operatorBefore });
    operatorBefore = nextOperator;
    text = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote) {
      text += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      text += char;
      continue;
    }
    if (char === "&" && command[index + 1] === "&") {
      push("&&");
      index += 1;
      continue;
    }
    if (char === "|" && command[index + 1] === "|") {
      push("||");
      index += 1;
      continue;
    }
    if (char === "|") {
      push("|");
      continue;
    }
    if (char === ";" || char === "\n") {
      push(";");
      continue;
    }
    text += char;
  }
  segments.push({ text: text.trim(), operatorBefore });
  return segments.filter((segment) => segment.text !== "");
}

/** Split one command into tokens, dropping the quotes around quoted tokens. */
export function tokenize(segment: string): Token[] {
  const tokens: Token[] = [];
  let value = "";
  let quoted = false;
  let started = false;
  let quote: '"' | "'" | null = null;

  for (const char of segment) {
    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      value += char;
      started = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoted = true;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) tokens.push({ value, quoted });
      value = "";
      quoted = false;
      started = false;
      continue;
    }
    value += char;
    started = true;
  }
  if (started) tokens.push({ value, quoted });
  return tokens;
}

/** `NODE_ENV=production cmd`: the setting a command is given, not the command. */
export const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
const PACKAGE_RUNNERS = new Set(["pnpm", "npm", "npx", "yarn", "bunx", "bun"]);
/** Tokens that sit between a runner and the real command. */
const RUNNER_PASSTHROUGH = new Set([
  "exec",
  "run",
  "dlx",
  "--if-present",
  "--silent",
  "-s",
  "-r",
  "--recursive",
  "-w",
  "--workspace-root",
  "cross-env",
  "env",
  "time",
]);
/** How a runner is told which package, or which directory, to run in. */
export const FILTER_FLAGS = new Set([
  "--filter",
  "-F",
  "--workspace",
  "-C",
  "--dir",
]);
const INFORMATIONAL_FLAGS = new Set([
  "--version",
  "-v",
  "--help",
  "-h",
  "--init",
  "--showConfig",
  "--listFiles",
]);

const basename = (value: string): string => value.split("/").pop() ?? value;

const hasFlag = (tokens: Token[], ...flags: string[]): boolean =>
  tokens.some((token) => flags.includes(token.value));

const hasFilter = (tokens: Token[]): boolean =>
  tokens.some(
    (token) =>
      FILTER_FLAGS.has(token.value) ||
      token.value.startsWith("--filter=") ||
      token.value.startsWith("--workspace="),
  );

/** Strip env assignments and runner wrappers to reach the real command. */
export function commandTokens(tokens: Token[]): Token[] {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (!token.quoted && ENV_ASSIGNMENT.test(token.value)) {
      index += 1;
      continue;
    }
    if (FILTER_FLAGS.has(token.value)) {
      index += 2; // the flag and the package or directory it selects
      continue;
    }
    if (
      token.value.startsWith("--filter=") ||
      token.value.startsWith("--workspace=")
    ) {
      index += 1;
      continue;
    }
    if (
      RUNNER_PASSTHROUGH.has(token.value) ||
      PACKAGE_RUNNERS.has(basename(token.value))
    ) {
      index += 1;
      continue;
    }
    break;
  }
  return tokens.slice(index);
}

/** Resolve the project a `tsc --build` targets, relative to its working dir. */
function buildTarget(args: Token[], workingDir: string): string {
  const positional = args.find((token) => !token.value.startsWith("-"));
  const target = path.resolve(workingDir, positional?.value ?? ".");
  return target.endsWith(".json") ? target : path.join(target, "tsconfig.json");
}

export function classifySegment(
  segment: string,
  context: PackageContext,
): SegmentKind {
  const tokens = tokenize(segment);
  const head = tokens.find((token) => !ENV_ASSIGNMENT.test(token.value));
  if (!head) return { kind: "other" };

  if (SHELLS.has(basename(head.value))) {
    const flagIndex = tokens.findIndex((token) => token.value === "-c");
    const inner = flagIndex === -1 ? undefined : tokens[flagIndex + 1];
    return inner ? { kind: "nested", command: inner.value } : { kind: "other" };
  }

  const runsFromWorkspaceRoot =
    basename(head.value) === "pnpm" &&
    hasFlag(tokens, "-w", "--workspace-root") &&
    !hasFilter(tokens);

  if (
    basename(head.value) === "pnpm" &&
    !hasFilter(tokens) &&
    tokens.some((token) => token.value === LIB_BUILD_SCRIPT) &&
    (runsFromWorkspaceRoot || context.isRootPackage)
  ) {
    return { kind: "rootLibsBuild" };
  }

  const command = commandTokens(tokens);
  const program = command[0];
  if (!program || basename(program.value) !== "tsc") return { kind: "other" };

  const args = command.slice(1);
  if (hasFlag(args, ...INFORMATIONAL_FLAGS)) return { kind: "other" };

  if (hasFlag(args, "-b", "--build")) {
    const workingDir = runsFromWorkspaceRoot
      ? context.root
      : context.packageDir;
    const target = buildTarget(
      args.filter((token) => !token.value.startsWith("-")),
      workingDir,
    );
    return target === path.resolve(context.root, "tsconfig.json")
      ? { kind: "rootLibsBuild" }
      : { kind: "localBuild" };
  }

  return { kind: "projectTypecheck" };
}

interface ScanResult {
  kind: ViolationKind | null;
  hint?: string;
}

/**
 * Walk a script left to right. A typecheck is compliant only when a root
 * library build ran earlier and every operator since was `&&`, so the
 * typecheck cannot run on a failed or skipped build.
 */
function scanCommand(
  command: string,
  context: PackageContext,
  buildGuaranteed: boolean,
): ScanResult {
  const segments = splitSegments(command);
  const kinds = segments.map((segment) =>
    classifySegment(segment.text, context),
  );

  let guaranteed = buildGuaranteed;
  let sawRootBuild = false;
  let sawLocalBuild = false;

  for (let index = 0; index < segments.length; index += 1) {
    const operator = segments[index]!.operatorBefore;
    if (operator === "||" || operator === "|" || operator === ";") {
      guaranteed = buildGuaranteed; // only an unconditional earlier build survives
    }
    const segmentKind = kinds[index]!;

    if (segmentKind.kind === "rootLibsBuild") {
      guaranteed = true;
      sawRootBuild = true;
      continue;
    }
    if (segmentKind.kind === "localBuild") {
      sawLocalBuild = true;
      continue;
    }
    if (segmentKind.kind === "nested") {
      const nested = scanCommand(segmentKind.command, context, guaranteed);
      if (nested.kind) return nested;
      continue;
    }
    if (segmentKind.kind !== "projectTypecheck" || guaranteed) continue;

    const buildLater = kinds
      .slice(index + 1)
      .some((later) => later.kind === "rootLibsBuild");
    const hint = sawLocalBuild
      ? "a package-local `tsc --build` builds this package's own project, not the shared libraries"
      : undefined;
    if (sawRootBuild) return { kind: "unguarded", hint };
    if (buildLater) return { kind: "out-of-order", hint };
    return { kind: "missing", hint };
  }
  return { kind: null };
}

export function findViolations(
  packages: WorkspacePackage[],
  root: string,
): Violation[] {
  const absoluteRoot = path.resolve(root);
  const violations: Violation[] = [];
  for (const pkg of packages) {
    const context: PackageContext = {
      root: absoluteRoot,
      packageDir: path.resolve(absoluteRoot, pkg.dir),
      isRootPackage: path.resolve(absoluteRoot, pkg.dir) === absoluteRoot,
    };
    for (const [script, command] of Object.entries(pkg.scripts)) {
      const result = scanCommand(command, context, false);
      if (!result.kind) continue;
      violations.push({
        dir: pkg.dir,
        name: pkg.name,
        script,
        command,
        kind: result.kind,
        ...(result.hint ? { hint: result.hint } : {}),
      });
    }
  }
  return violations;
}

/** Package globs declared in `pnpm-workspace.yaml`, negations included. */
export function readWorkspaceGlobs(workspaceYaml: string): string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const line of workspaceYaml.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (/^\S/.test(line)) break; // the next top-level key ends the block
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const item = /^-\s*(.+)$/.exec(trimmed);
    if (!item) break;
    globs.push(item[1]!.trim().replace(/^['"]|['"]$/g, ""));
  }
  return globs;
}

function readManifest(root: string, dir: string): WorkspacePackage {
  const manifestPath = path.join(root, dir, "package.json");
  let parsed: { name?: string; scripts?: Record<string, string> };
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${dir}/package.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { dir, name: parsed.name ?? dir, scripts: parsed.scripts ?? {} };
}

/** Every workspace package, plus the workspace root itself. */
export function collectWorkspacePackages(root: string): WorkspacePackage[] {
  const globs = readWorkspaceGlobs(
    readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"),
  );
  const matchDirs = (glob: string): string[] =>
    globSync(`${glob}/package.json`, { cwd: root }).map((match) =>
      path.dirname(match),
    );

  const dirs = new Set<string>(["."]);
  const excluded = new Set<string>();
  for (const glob of globs) {
    if (glob.startsWith("!")) {
      for (const dir of matchDirs(glob.slice(1))) excluded.add(dir);
      continue;
    }
    for (const dir of matchDirs(glob)) dirs.add(dir);
  }

  return [...dirs]
    .filter((dir) => !excluded.has(dir))
    .sort()
    .map((dir) => readManifest(root, dir));
}

const WHY = [
  "Why: a package typechecks a workspace library through that library's generated",
  "declarations in lib/<name>/dist, not through its TypeScript source. dist is",
  "gitignored, so a script that runs tsc on its own measures the package against an",
  "absent or stale contract and reports errors the full `pnpm run typecheck` never",
  "sees — TS6305, or a misleading \"Property 'x' does not exist\" for a field the",
  `library plainly declares. Only \`${LIB_BUILD_PREFIX}\` (the root \`tsc --build\`)`,
  "rebuilds those declarations, and it has to be joined with && so a failed build",
  "stops the typecheck instead of letting it read stale output.",
].join("\n");

const KIND_EXPLANATION: Record<ViolationKind, string> = {
  missing: "no shared-library build runs first",
  "out-of-order": "the shared-library build runs after the typecheck",
  unguarded:
    "the shared-library build is not joined with && so its failure does not stop the typecheck",
};

export function formatViolations(violations: Violation[]): string {
  const lines = [
    `${violations.length} typecheck script${
      violations.length === 1 ? "" : "s"
    } can report type errors the full \`pnpm run typecheck\` does not:`,
    "",
  ];
  for (const violation of violations) {
    lines.push(`  ${violation.dir}/package.json → "${violation.script}"`);
    lines.push(`      now: ${violation.command}`);
    lines.push(`      problem: ${KIND_EXPLANATION[violation.kind]}`);
    if (violation.hint) lines.push(`      note: ${violation.hint}`);
    lines.push(
      violation.kind === "missing"
        ? `      fix: ${LIB_BUILD_PREFIX} && ${violation.command}`
        : `      fix: start the script with \`${LIB_BUILD_PREFIX} &&\``,
    );
    lines.push("");
  }
  lines.push(WHY);
  return lines.join("\n");
}

export function checkWorkspace(root: string): string | null {
  const packages = collectWorkspacePackages(root);
  const rootPackage = packages.find((pkg) => pkg.dir === ".");
  if (!rootPackage || !(LIB_BUILD_SCRIPT in rootPackage.scripts)) {
    return [
      `The root package.json no longer defines a "${LIB_BUILD_SCRIPT}" script.`,
      "",
      `Every artifact typecheck runs \`${LIB_BUILD_PREFIX}\` before its own tsc run.`,
      "Restore that script (`tsc --build`), or rename it in every package that",
      "calls it and in this check.",
      "",
      WHY,
    ].join("\n");
  }

  const violations = findViolations(packages, root);
  return violations.length === 0 ? null : formatViolations(violations);
}

function main(): void {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const failure = checkWorkspace(root);
  if (failure) {
    console.error(`\nWorkspace typecheck convention violated\n\n${failure}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Typecheck scripts build the shared libraries first (${LIB_BUILD_PREFIX} && ...).`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
