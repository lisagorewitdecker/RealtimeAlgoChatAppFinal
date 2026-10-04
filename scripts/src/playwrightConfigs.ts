/**
 * Where this workspace's Playwright configs are, and what counts as one.
 *
 * Two checks read these configs: checkBrowserTestRequirements.ts, which holds
 * each one to announcing the settings its own specs need, and
 * checkBrowserOutput.ts, which holds it to writing failure snapshots outside
 * the repository and keeping none of them. They used to look in different
 * places and recognize a config by different rules — one read a single
 * directory, `artifacts/api-server/e2e`, and took every `*.config.ts` in it
 * for Playwright's; the other walked `artifacts/` and asked for the
 * `playwright*` name or an `@playwright/test` import beside `defineConfig`.
 *
 * A config added anywhere else was therefore held to one convention and not
 * the other: a browser suite in `artifacts/chat-app` had its output checked
 * and its settings requirement not, which is exactly the quiet pass the first
 * check exists to stop, and a config above `artifacts/` — at the workspace
 * root, or under `lib/` — was seen by neither. Neither gap read as a failure.
 * Both checks reported success on what they had looked at.
 *
 * So discovery is stated once, here, and both checks search the whole
 * workspace. Searching wider makes the second question matter more: a bare
 * `*.config.ts` is no longer assumed to be Playwright's, because the tree now
 * holds vitest, jest, metro, drizzle, and vite configs that have no say in
 * either convention.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { IGNORED_DIRECTORIES } from "./checkTestScripts.ts";

/**
 * The tree both checks search: this workspace, from its root. Wide enough to
 * reach a config in any package — `artifacts/*`, `lib/*`, `scripts` — and one
 * written above all of them.
 */
export const WORKSPACE_TREE = ".";

/** Files a config or a module it names can be written in. */
export const MODULE_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

/** `playwright.config.ts`, `playwright.moderation.config.ts`, and the like. */
const CONFIG_FILENAME = /^playwright[\w.-]*\.config\.[cm]?[jt]s$/;

/** A file that builds a Playwright config, whatever it is called. */
export const DEFINE_CONFIG = /\bdefineConfig\s*(?:<[^<>]*>\s*)?\(/;

const PLAYWRIGHT_IMPORT = /["']@playwright\/test["']/;

/**
 * A suite, which is what a config runs rather than what configures a run.
 * Named apart because a suite about Playwright configs quotes one: the checks
 * in this directory are tested against config sources written inline, and a
 * fixture read as a real config would fail conventions nothing here breaks.
 */
const TEST_FILENAME = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** A directory holding tooling state rather than a package: `.git`, caches. */
const HIDDEN_DIRECTORY = /^\./;

const toPosix = (value: string): string => value.split(path.sep).join("/");

/**
 * Source with its comments removed, so a commented-out entry never counts as
 * a setting. A line comment is only recognized where `//` starts a line or
 * follows whitespace or a separator, which keeps the escaped slashes of a
 * `testMatch` regular expression from eating the rest of a line.
 */
export function stripComments(source: string): string {
  let out = "";
  let quote: '"' | "'" | "`" | null = null;
  let previous = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1];
    if (quote) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      previous = char;
      continue;
    }
    if (
      char === "/" &&
      next === "/" &&
      (previous === "" || /[\s;,({[]/.test(previous))
    ) {
      while (index < source.length && source[index] !== "\n") index += 1;
      out += "\n";
      previous = "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 1;
      out += " ";
      previous = " ";
      continue;
    }
    out += char;
    previous = char;
  }
  return out;
}

/**
 * Whether a file configures a Playwright run: named the way Playwright's
 * configs are named, or building one from `@playwright/test` under some other
 * name. A spec or test file is neither, however much of a config it quotes.
 */
export function isPlaywrightConfig(name: string, source: string): boolean {
  if (TEST_FILENAME.test(name)) return false;
  if (CONFIG_FILENAME.test(name)) return true;
  const code = stripComments(source);
  return PLAYWRIGHT_IMPORT.test(code) && DEFINE_CONFIG.test(code);
}

/**
 * This workspace's own modules anywhere under one directory, as
 * workspace-relative paths sorted for a stable report. Symlinks are not
 * followed, and dependency, build, and dot directories are skipped: a file
 * reached that way belongs to a dependency or to a tool, not to a package
 * here.
 *
 * `extensions` says which files count, defaulting to the modules a run
 * loads. The settings search in checkBrowserTestRequirements.ts asks for
 * those and the two a component is written in — a setting read in a screen
 * is still one this workspace has, while a Playwright config is not written
 * in either — and the walk itself stays one thing, so the two searches
 * cannot come to disagree about which directories are this workspace's.
 */
export function findWorkspaceModules(
  root: string,
  dir: string = WORKSPACE_TREE,
  extensions: readonly string[] = MODULE_EXTENSIONS,
): string[] {
  const modules: string[] = [];
  const walk = (relative: string): void => {
    let entries;
    try {
      entries = readdirSync(path.join(root, relative), { withFileTypes: true });
    } catch {
      return; // a directory that cannot be read holds no modules
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (
          !IGNORED_DIRECTORIES.has(entry.name) &&
          !HIDDEN_DIRECTORY.test(entry.name)
        ) {
          walk(child);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (extensions.some((extension) => entry.name.endsWith(extension)))
        modules.push(toPosix(child));
    }
  };
  walk(dir);
  return modules.sort();
}

/**
 * Those of them that configure a Playwright run, read from the same walk: a
 * config is one of this workspace's modules, recognized by what it is called
 * or by what it builds.
 */
export function findPlaywrightConfigs(
  root: string,
  dir: string = WORKSPACE_TREE,
): string[] {
  const configs: string[] = [];
  for (const module of findWorkspaceModules(root, dir)) {
    let source;
    try {
      source = readFileSync(path.join(root, module), "utf8");
    } catch {
      continue; // a file that cannot be read configures nothing
    }
    if (isPlaywrightConfig(path.posix.basename(module), source))
      configs.push(module);
  }
  return configs;
}
