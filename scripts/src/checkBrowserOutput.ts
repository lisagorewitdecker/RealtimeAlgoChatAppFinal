/**
 * Workspace consistency check: every Playwright config in this workspace
 * writes its failure output outside the repository and keeps none of it.
 *
 * A Playwright failure snapshot copies the page as it stands. When a sign-in
 * form is on that page, the copy holds whatever was typed into it, password
 * field included — a failed sign-in that waits for some later state leaves the
 * value in the DOM until Playwright captures its error context. Masking log
 * messages does not touch it.
 *
 * Playwright writes that output to `test-results/` inside the package owning
 * the config and keeps it after the run, and every config decides this for
 * itself: redirecting one config protects that suite and nothing else, so the
 * next browser config added here starts out writing sign-in pages back into a
 * working copy. The repository ignores the default directory, which keeps such
 * a file from being committed, but it is still written and still read by
 * whoever opens it.
 *
 * Each config therefore names an `outputDir` outside the repository — a
 * directory under `tmpdir()` from `node:os`, or an absolute path elsewhere —
 * and sets `preserveOutput: "never"` so the run deletes what it wrote.
 * `"failures-only"` is not enough: a failure is exactly the run that captured
 * the page.
 *
 * `outputDir` is a per-project setting as well as a run-wide one, so the
 * config's own entry is not the whole answer: a project naming its own
 * `outputDir` writes there instead, and a project naming none falls back to
 * the run-wide entry, or to the default inside the package when there is no
 * run-wide entry. Every `outputDir` in a config is therefore read, and one has
 * to cover the run as a whole.
 *
 * Where that directory comes from matters as much as its shape. A path taken
 * from the environment is decided after this check has run and can name any
 * place at all, this repository included, so it is refused rather than trusted
 * — falling back to a temporary directory when the variable is unset says
 * nothing about the run where it is set.
 *
 * How the path is put together matters just as much. `resolve()` reads its
 * arguments from the right until it has an absolute path, so a safe first
 * argument decides nothing: `resolve(tmpdir(), process.cwd(), "test-results")`
 * lands in the working directory, which is this repository. Every argument is
 * therefore read, and one whose destination cannot be established is refused
 * instead of assumed to be harmless.
 *
 * These things therefore fail here:
 *   - a config whose exported object this check cannot find, so nothing in it
 *     can be read;
 *   - a config naming no run-wide `outputDir`, which leaves it at the default
 *     inside the package;
 *   - any `outputDir`, run-wide or a project's own, that this check cannot see
 *     rooted outside the repository;
 *   - any `outputDir` read from the environment;
 *   - a config naming no `preserveOutput`, which leaves it at `"always"`;
 *   - a `preserveOutput` that keeps output from any run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFINE_CONFIG,
  findPlaywrightConfigs,
  stripComments,
} from "./playwrightConfigs.ts";

/**
 * A compliant config, named in the report as the shape to copy.
 */
export const EXEMPLAR_CONFIG =
  "artifacts/api-server/e2e/playwright.moderation.config.ts";

/** The config key naming where a run writes its output. */
export const OUTPUT_DIR_KEY = "outputDir";

/** The config key deciding whether that output outlives the run. */
export const PRESERVE_OUTPUT_KEY = "preserveOutput";

/** The one setting that keeps nothing. */
export const PRESERVE_OUTPUT_VALUE = "never";

/** The function a config roots its output directory with. */
export const TEMP_DIR_FUNCTION = "tmpdir";

/** Where that function comes from. */
const OS_MODULE = /^(?:node:)?os$/;

/** A path segment climbing out of wherever the expression started. */
const TRAVERSAL = /(?<![.\w])\.\.(?![.\w])/;

/** A value this check cannot know until the run starts. */
const ENVIRONMENT = /\bprocess\s*\.\s*env\b|\bprocess\.env\[/;

const OPENING = "([{";
const CLOSING = ")]}";

/** The text a bracket pair encloses, or null where the pair never closes. */
function enclosed(code: string, open: number): string | null {
  if (!OPENING.includes(code[open] ?? "")) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let index = open; index < code.length; index += 1) {
    const char = code[index]!;
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (OPENING.includes(char)) depth += 1;
    else if (CLOSING.includes(char)) {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, index);
    }
  }
  return null;
}

/** Where one position sits: how deeply nested it is, and whether it is text. */
function positionAt(
  code: string,
  index: number,
): {
  depth: number;
  quoted: boolean;
} {
  let depth = 0;
  let quote: string | null = null;
  for (let at = 0; at < index; at += 1) {
    const char = code[at]!;
    if (quote) {
      if (char === "\\") at += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (OPENING.includes(char)) depth += 1;
    else if (CLOSING.includes(char)) depth -= 1;
  }
  return { depth, quoted: quote !== null };
}

/** One entry's value, read from just after its colon to the end of the entry. */
function readValueFrom(code: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  let value = "";
  for (let index = start; index < code.length; index += 1) {
    const char = code[index]!;
    if (quote) {
      value += char;
      if (char === "\\") {
        value += code[index + 1] ?? "";
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      value += char;
      continue;
    }
    if (OPENING.includes(char)) depth += 1;
    if (CLOSING.includes(char)) {
      if (depth === 0) break; // the object this entry belongs to ended
      depth -= 1;
    }
    if (depth === 0 && (char === "," || char === "\n")) break;
    value += char;
  }
  return value.trim();
}

/**
 * The object a config exports, with its comments removed, or null where this
 * check cannot find it. `defineConfig({ ... })` is what Playwright documents
 * and what every config here is written as; a plain exported object, and one
 * bound to a name first, are read too.
 */
export function configObject(source: string): string | null {
  const code = stripComments(source);

  const call = DEFINE_CONFIG.exec(code);
  if (call) {
    const brace = code.indexOf("{", call.index + call[0].length - 1);
    if (brace !== -1) {
      const body = enclosed(code, brace);
      if (body !== null) return body;
    }
  }

  const literal = /export\s+default\s*\{/.exec(code);
  if (literal) {
    const body = enclosed(code, code.indexOf("{", literal.index));
    if (body !== null) return body;
  }

  const named = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/.exec(code);
  if (named) {
    const declaration = new RegExp(
      `(?:const|let|var)\\s+${named[1]!}\\b[^=;]*=\\s*`,
    ).exec(code);
    if (declaration) {
      const start = declaration.index + declaration[0].length;
      if (code[start] === "{") {
        const body = enclosed(code, start);
        if (body !== null) return body;
      }
    }
  }
  return null;
}

export interface ConfigEntry {
  /** The expression assigned, read whole. */
  value: string;
  /** 0 for the config's own entries, deeper for a project's or a nested one's. */
  depth: number;
}

/**
 * Every entry a config object assigns to one key, run-wide and nested alike.
 * Reading only the first would miss a project overriding it further down.
 */
export function readEntries(object: string, key: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const pattern = new RegExp(`(?:^|[\\s{,;(\\[])["']?${key}["']?\\s*:`, "g");
  for (const match of object.matchAll(pattern)) {
    const { depth, quoted } = positionAt(object, match.index);
    if (quoted) continue; // the key was named inside a string, not assigned
    entries.push({
      value: readValueFrom(object, match.index + match[0].length),
      depth,
    });
  }
  return entries;
}

interface OsBindings {
  /** Local names bound to `tmpdir` itself. */
  direct: string[];
  /** Local names bound to the whole module, called as `<name>.tmpdir()`. */
  namespaces: string[];
}

const IDENTIFIER = /^\w+$/;

/** The names one import or require clause binds. */
function readBindings(clause: string, bindings: OsBindings): void {
  const braces = /\{([^}]*)\}/.exec(clause);
  if (braces) {
    for (const entry of braces[1]!.split(",")) {
      const text = entry.trim().replace(/^type\s+/, "");
      if (!text) continue;
      const parts = text.split(/\s*:\s*|\s+as\s+/);
      if (parts[0]!.trim() !== TEMP_DIR_FUNCTION) continue;
      const local = (parts[1] ?? parts[0])!.trim();
      if (IDENTIFIER.test(local)) bindings.direct.push(local);
    }
  }
  const rest = clause.replace(/\{[^}]*\}/, "").replace(/^type\s+/, "");
  for (const part of rest.split(",")) {
    const text = part.trim();
    if (!text) continue;
    // `import * as os` and `import os` both reach tmpdir as a property.
    const namespace = /^\*\s+as\s+(\w+)$/.exec(text)?.[1] ?? text;
    if (IDENTIFIER.test(namespace)) bindings.namespaces.push(namespace);
  }
}

/** What a module's own imports call `node:os` and its `tmpdir` export. */
export function osBindings(source: string): OsBindings {
  const code = stripComments(source);
  const bindings: OsBindings = { direct: [], namespaces: [] };
  for (const match of code.matchAll(
    /import\s+([\w$*{},:\s]+?)\s+from\s*["']([^"']+)["']/g,
  )) {
    if (OS_MODULE.test(match[2]!)) readBindings(match[1]!, bindings);
  }
  for (const match of code.matchAll(
    /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g,
  )) {
    if (OS_MODULE.test(match[2]!)) readBindings(match[1]!, bindings);
  }
  return bindings;
}

/**
 * Whether an expression is a call to `tmpdir()` from `node:os`. A local helper
 * of the same name does not count: only the operating system's temporary
 * directory is known to sit outside the repository.
 */
export function namesTemporaryDirectory(
  source: string,
  expression: string,
): boolean {
  const text = expression.trim();
  const { direct, namespaces } = osBindings(source);
  const bare = /^([\w$]+)\s*\(\s*\)$/.exec(text);
  if (bare && direct.includes(bare[1]!)) return true;
  const property = new RegExp(
    `^([\\w$]+)\\s*\\.\\s*${TEMP_DIR_FUNCTION}\\s*\\(\\s*\\)$`,
  ).exec(text);
  return property !== null && namespaces.includes(property[1]!);
}

/** Whether a path names a place inside the workspace. */
function isInsideRepository(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/** An expression split on one top-level operator, ignoring nested text. */
function splitTopLevel(expression: string, operator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index]!;
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (OPENING.includes(char)) depth += 1;
    else if (CLOSING.includes(char)) depth -= 1;
    else if (depth === 0 && expression.startsWith(operator, index)) {
      parts.push(expression.slice(start, index));
      index += operator.length - 1;
      start = index + 1;
    }
  }
  parts.push(expression.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * The paths an expression can produce where it chooses between them, or null
 * where it produces one. Each has to be rooted outside the repository on its
 * own: an unsafe path is no safer for having a safe alternative.
 */
function alternatives(expression: string): string[] | null {
  for (const operator of ["??", "||"]) {
    const parts = splitTopLevel(expression, operator);
    if (parts.length > 1) return parts;
  }
  // A ternary's condition is not a path, so only its two answers are read.
  const branches = splitTopLevel(expression, "?");
  if (branches.length === 2) {
    const answers = splitTopLevel(branches[1]!, ":");
    if (answers.length === 2) return answers;
  }
  return null;
}

export type RootVerdict =
  /** The path starts somewhere this check knows is outside the repository. */
  | "outside"
  /** It starts inside the repository, climbs back into it, or cannot be read. */
  | "inside"
  /** It is chosen at run time, so it can name anywhere at all. */
  | "environment";

/** Whether one literal path lands outside the repository. */
function literalVerdict(root: string, literal: string): RootVerdict {
  if (!path.isAbsolute(literal)) return "inside"; // resolved against the config
  return isInsideRepository(root, literal) ? "inside" : "outside";
}

/** An expression with its wrapping parentheses removed. */
function unwrap(expression: string): string {
  let text = expression.trim();
  while (text.startsWith("(")) {
    const inner = enclosed(text, 0);
    if (inner === null || inner.length !== text.length - 2) break;
    text = inner.trim();
  }
  return text;
}

/**
 * What one argument of a path call does to the path being built, which is not
 * the same question as where that argument lands: `resolve` starts the path
 * over at any argument that is absolute, so an argument's own shape decides
 * whether the ones before it still count for anything.
 */
type PathArgument =
  /** An absolute path, which `resolve` restarts from. */
  | { kind: "absolute"; verdict: RootVerdict }
  /** A relative path, which can only be appended to what came before. */
  | { kind: "relative" }
  /** Neither could be established, so it may restart the path anywhere. */
  | { kind: "unknown" };

const UNKNOWN: PathArgument = { kind: "unknown" };
const RELATIVE: PathArgument = { kind: "relative" };

/** Whether an argument is absolute, and where it starts when it is. */
function classifyArgument(
  root: string,
  source: string,
  expression: string,
): PathArgument {
  const text = unwrap(expression);

  const branches = alternatives(text);
  if (branches) {
    const classified = branches.map((branch) =>
      classifyArgument(root, source, branch),
    );
    if (classified.every((argument) => argument.kind === "relative")) {
      return RELATIVE;
    }
    if (classified.some((argument) => argument.kind !== "absolute")) {
      return UNKNOWN; // one branch restarts the path where another may not
    }
    const verdicts = classified.map((argument) =>
      argument.kind === "absolute" ? argument.verdict : "inside",
    );
    return {
      kind: "absolute",
      verdict: verdicts.includes("inside") ? "inside" : "outside",
    };
  }

  // Appending to a path cannot make it absolute, so the first part decides.
  const concatenated = splitTopLevel(text, "+");
  if (concatenated.length > 1) {
    return classifyArgument(root, source, concatenated[0]!);
  }

  if (/^(?:[\w$]+\s*\.\s*)?(?:join|resolve)\s*\(/.test(text)) {
    // A nested call this check can see rooted outside the repository is an
    // absolute path; anything else it may or may not be, and either answer
    // fails the call holding it.
    const verdict = rootVerdict(root, source, text);
    return verdict === "outside" ? { kind: "absolute", verdict } : UNKNOWN;
  }

  if (namesTemporaryDirectory(source, text)) {
    return { kind: "absolute", verdict: "outside" };
  }

  const quoted = /^(["'])((?:[^\\]|\\.)*?)\1$/.exec(text);
  if (quoted) {
    return path.isAbsolute(quoted[2]!)
      ? { kind: "absolute", verdict: literalVerdict(root, quoted[2]!) }
      : RELATIVE;
  }

  if (text.startsWith("`") && text.endsWith("`") && text.length > 1) {
    const inner = text.slice(1, -1);
    if (inner.startsWith("${")) {
      const interpolated = enclosed(inner, 1);
      return interpolated === null
        ? UNKNOWN
        : classifyArgument(root, source, interpolated);
    }
    const literal = inner.split("${")[0]!;
    return path.isAbsolute(literal)
      ? { kind: "absolute", verdict: literalVerdict(root, literal) }
      : RELATIVE;
  }

  return UNKNOWN;
}

/**
 * Where `resolve(...)` puts the path it builds. Node reads its arguments from
 * the right until it has an absolute path, so the first one is not the root:
 * `resolve(tmpdir(), process.cwd(), "test-results")` lands under the working
 * directory, which is this repository. The last argument this check can see
 * is absolute is therefore the root; everything after it has to be a path
 * that can only be appended, and an argument whose shape cannot be
 * established is refused rather than assumed to append.
 */
function resolveVerdict(
  root: string,
  source: string,
  args: string[],
): RootVerdict {
  const classified = args.map((argument) =>
    classifyArgument(root, source, argument),
  );
  let start = -1;
  for (let index = 0; index < classified.length; index += 1) {
    if (classified[index]!.kind === "absolute") start = index;
  }
  // With no absolute argument at all, resolve starts at the working directory.
  if (start === -1) return "inside";
  for (const argument of classified.slice(start + 1)) {
    if (argument.kind !== "relative") return "inside"; // it may restart the path
  }
  const rooted = classified[start]!;
  return rooted.kind === "absolute" ? rooted.verdict : "inside";
}

/**
 * Where the expression's first element puts the path it builds. A later
 * element of a `join` can only be appended to it, so it cannot move the root;
 * `resolve` is read whole, because any of its arguments can become the root.
 */
function rootVerdict(
  root: string,
  source: string,
  expression: string,
): RootVerdict {
  const text = unwrap(expression);

  // A concatenation is rooted by whatever comes first.
  const concatenated = splitTopLevel(text, "+");
  if (concatenated.length > 1)
    return rootVerdict(root, source, concatenated[0]!);

  const builder = /^(?:[\w$]+\s*\.\s*)?(join|resolve)\s*\(/.exec(text);
  if (builder) {
    const args = enclosed(text, text.indexOf("("));
    const parts = args === null ? [] : splitTopLevel(args, ",");
    if (parts.length === 0) return "inside";
    return builder[1] === "join"
      ? rootVerdict(root, source, parts[0]!)
      : resolveVerdict(root, source, parts);
  }

  if (namesTemporaryDirectory(source, text)) return "outside";

  const quoted = /^(["'])((?:[^\\]|\\.)*?)\1$/.exec(text);
  if (quoted) return literalVerdict(root, quoted[2]!);

  if (text.startsWith("`") && text.endsWith("`") && text.length > 1) {
    const inner = text.slice(1, -1);
    if (inner.startsWith("${")) {
      const interpolated = enclosed(inner, 1);
      return interpolated === null
        ? "inside"
        : rootVerdict(root, source, interpolated);
    }
    const literal = inner.split("${")[0]!;
    return literalVerdict(root, literal);
  }

  // A call, an identifier, or anything else this check cannot follow: a path
  // nobody can follow is a path nobody reviews.
  return "inside";
}

/**
 * Where an `outputDir` expression puts the run's output. A path built from
 * `tmpdir()`, or an absolute path elsewhere, is outside the repository; a
 * relative path is resolved against the config's own directory and lands
 * inside it; a path that climbs with `..` can land anywhere, and one taken
 * from the environment is not decided here at all.
 */
export function outputDirVerdict(
  root: string,
  source: string,
  expression: string,
): RootVerdict {
  const text = expression.trim();
  if (ENVIRONMENT.test(text)) return "environment";
  if (TRAVERSAL.test(text)) return "inside";
  const branches = alternatives(text);
  if (branches) {
    for (const branch of branches) {
      const verdict = outputDirVerdict(root, source, branch);
      if (verdict !== "outside") return verdict;
    }
    return "outside";
  }
  return rootVerdict(root, source, text);
}

/** Whether a `preserveOutput` expression is the literal `"never"`. */
export function keepsNothing(expression: string): boolean {
  return new RegExp(`^["']${PRESERVE_OUTPUT_VALUE}["']$`).test(
    expression.trim(),
  );
}

export type OutputProblemKind =
  /** The exported config object cannot be found, so nothing in it was read. */
  | "unreadable-config"
  /** No run-wide `outputDir`: what no project overrides lands in the package. */
  | "default-output-dir"
  /** An `outputDir` that is not rooted outside the repository. */
  | "repository-output-dir"
  /** An `outputDir` the environment chooses, so it can name anywhere. */
  | "environment-output-dir"
  /** No `preserveOutput`: Playwright keeps the output, which defaults to `always`. */
  | "default-preserve-output"
  /** A `preserveOutput` that keeps output from some runs, or all of them. */
  | "preserved-output";

export interface ConfigProblem {
  /** Workspace-relative path of the Playwright config. */
  config: string;
  /** Everything wrong with this config, in reporting order. */
  kinds: OutputProblemKind[];
  /** What the config assigns today, one line per entry found. */
  settings: string[];
}

/** How an entry is named in the report: run-wide, or one project's own. */
const describe = (key: string, entry: ConfigEntry): string =>
  `${key}${entry.depth === 0 ? "" : " (a project's own)"}: ${entry.value}`;

/** What one config does with its failure output, or null when nothing is wrong. */
export function inspectConfig(
  root: string,
  config: string,
): ConfigProblem | null {
  const source = readFileSync(path.join(root, config), "utf8");
  const object = configObject(source);
  if (object === null) {
    return { config, kinds: ["unreadable-config"], settings: [] };
  }

  const outputDirs = readEntries(object, OUTPUT_DIR_KEY);
  const preserves = readEntries(object, PRESERVE_OUTPUT_KEY);
  const kinds = new Set<OutputProblemKind>();
  const settings: string[] = [];

  if (!outputDirs.some((entry) => entry.depth === 0)) {
    kinds.add("default-output-dir");
  }
  for (const entry of outputDirs) {
    settings.push(describe(OUTPUT_DIR_KEY, entry));
    const verdict = outputDirVerdict(root, source, entry.value);
    if (verdict === "environment") kinds.add("environment-output-dir");
    else if (verdict === "inside") kinds.add("repository-output-dir");
  }

  if (!preserves.some((entry) => entry.depth === 0)) {
    kinds.add("default-preserve-output");
  }
  for (const entry of preserves) {
    settings.push(describe(PRESERVE_OUTPUT_KEY, entry));
    if (!keepsNothing(entry.value)) kinds.add("preserved-output");
  }

  if (kinds.size === 0) return null;
  return { config, kinds: [...kinds], settings };
}

const WHY = [
  "Why: a failure snapshot copies the page as it stands, sign-in form included, so",
  "it can hold a password that was typed into it — a failed sign-in leaves the",
  "value in the page until Playwright captures its error context, and masking log",
  "messages does not remove it. Playwright writes that output into the package",
  "owning the config and keeps it, and every config decides this for itself, so",
  `redirecting one ${OUTPUT_DIR_KEY} protects that suite and nothing else. The`,
  "repository ignores the default directory, which keeps such a file from being",
  "committed, but it is still written into a working copy and still read by",
  "whoever opens it.",
].join("\n");

const KIND_EXPLANATION: Record<OutputProblemKind, string> = {
  "unreadable-config": `this check cannot find the object it exports, so neither its ${OUTPUT_DIR_KEY} nor its ${PRESERVE_OUTPUT_KEY} could be read`,
  "default-output-dir": `it names no run-wide ${OUTPUT_DIR_KEY}, so anything no project overrides is written to test-results/ inside the package`,
  "repository-output-dir": `an ${OUTPUT_DIR_KEY} here is not rooted outside the repository — a relative path, a climb back into it with .., or an expression this check cannot follow`,
  "environment-output-dir": `an ${OUTPUT_DIR_KEY} here is taken from the environment, which can name a path inside the repository on the run that matters`,
  "default-preserve-output": `it names no ${PRESERVE_OUTPUT_KEY}, so Playwright keeps what the run wrote`,
  "preserved-output": `its ${PRESERVE_OUTPUT_KEY} keeps output the run wrote, and a failed run is the one that captured the page`,
};

export function formatProblems(problems: ConfigProblem[]): string {
  const lines = [
    `${problems.length} Playwright config${problems.length === 1 ? "" : "s"} in this workspace can leave a captured sign-in page inside the repository:`,
    "",
  ];
  for (const problem of problems) {
    lines.push(`  ${problem.config}`);
    for (const setting of problem.settings) {
      lines.push(`      now: ${setting}`);
    }
    for (const kind of problem.kinds) {
      lines.push(`      problem: ${KIND_EXPLANATION[kind]}`);
    }
    lines.push(
      `      fix: with \`import { tmpdir } from "node:os"\` and \`import { join } from "node:path"\`, give`,
      `           the config — and every project of its own naming one — `,
      `           ${OUTPUT_DIR_KEY}: join(tmpdir(), \`<suite>-playwright-\${process.pid}\`),`,
      `           ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",`,
      `           ${EXEMPLAR_CONFIG} is the shape to`,
      `           copy. A directory read from the environment is not accepted: nothing here`,
      `           can tell what it will name on the run where it is set.`,
      "",
    );
  }
  return lines.join("\n");
}

export function checkWorkspace(root: string): string | null {
  const configs = findPlaywrightConfigs(root);
  if (configs.length === 0) {
    return [
      "No Playwright config was found in this workspace.",
      "",
      "That is reported as a failure on purpose: a check with nothing to check",
      "passes exactly the way a compliant workspace does. Either the browser",
      "suites moved somewhere this search does not reach, in which case widen",
      "it in scripts/src/playwrightConfigs.ts, or they are gone and this check",
      "should go with them.",
      "",
      WHY,
    ].join("\n");
  }

  const problems = configs
    .map((config) => inspectConfig(root, config))
    .filter((problem): problem is ConfigProblem => problem !== null);
  if (problems.length === 0) return null;
  return [formatProblems(problems), WHY].join("\n");
}

function main(): void {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const failure = checkWorkspace(root);
  if (failure) {
    console.error(`\nBrowser output convention violated\n\n${failure}\n`);
    process.exitCode = 1;
    return;
  }
  const configs = findPlaywrightConfigs(root);
  console.log(
    `All ${configs.length} Playwright config${configs.length === 1 ? "" : "s"} in this workspace write failure output outside the repository and keep none of it.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
