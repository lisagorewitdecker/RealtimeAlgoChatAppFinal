/**
 * Workspace consistency check: every command declared in the shared
 * requirement module names the settings it cannot run without before it
 * starts, and the list it names is the one it really reads.
 *
 * A browser suite is reached through a Playwright config, so the settings its
 * cases need are decided once in that config's `globalSetup` —
 * `scripts/src/checkBrowserTestRequirements.ts` is what holds every config in
 * the tree to that. The commands here are reached by no config and no spec:
 * they are `node <module>` entry points into the same disposable-account
 * recovery helpers the moderation fixture uses, run by hand after an
 * interrupted moderation run, so nothing held them to a list at all.
 *
 * That is the same quiet gap arriving from the other side, and worse for what
 * these commands do. Each hands the whole environment to `assertDevelopment`
 * and `recoverDisposables`, and a setting one of them needs that an
 * environment does not provide surfaced as a throw partway through: after the
 * database pool was open, after the provider had been asked for the moderator
 * accounts the sweep must not delete, and caught by the command's own handler
 * — which prints no provider details, by design — so it read as the recovery
 * having failed rather than as a setting to set. The person running it is
 * mid-cleanup of accounts an abandoned run left behind, which is the worst
 * moment to be told only that something went wrong.
 *
 * So each command declares its settings beside the suites' in the shared
 * module, and calls `requireCommandSettings(<its own declaration>)` before it
 * opens anything: a run missing one is refused by name, having created and
 * deleted nothing. This checks that wiring, and then holds the declared list
 * to what the command actually reads.
 *
 * What fails here:
 *   - a declaration whose `command` is not a plain module name, so nothing
 *     can be read for it and the command is held to nothing;
 *   - a declaration naming a module that is not on disk;
 *   - a command that never calls `requireCommandSettings`, so a missing
 *     setting is a throw partway through again;
 *   - one that calls it and drops the answer, which prints the notice and
 *     then goes on to delete accounts anyway;
 *   - one announcing another command's declaration — these two modules are
 *     read side by side, and the verifier holding itself to the sweep's list
 *     would start without its own opt-in;
 *   - a command declaring the browser run it starts where that run is not a
 *     suite declared here, is not the run that module starts, or needs a
 *     setting the command does not require — the three ways that declaration
 *     stops covering the environment the command spreads into it;
 *   - an `optional` entry stating no line about what the command does
 *     without that setting, which leaves whoever reads the declaration a
 *     bare name to decide by;
 *   - the settings disagreements the suites are held to, by the same
 *     comparison in both directions: a setting the command reads that it
 *     declares neither way, a `required` entry nothing reads any more, an
 *     `optional` one nothing reads, a helper handed the environment whose
 *     reads cannot be followed, and a workspace import reaching no file;
 *   - and, from the other side, a package script running such a command
 *     that no declaration names at all, which is held to nothing.
 *
 * That last one is why the commands are not taken from the declarations
 * alone. Which modules are commands cannot be read off the filesystem — the
 * recovery tests, the timeout verifier and the fixtures sit in the same
 * directory as the two commands, and a name settles nothing — but a package
 * script is the evidence that someone runs a module by hand, since
 * `pnpm --filter <package> run <script>` is how they run it. So a script
 * running a module in that directory with `node` has to name a declaration
 * for it, or the gap this check closes simply arrives as the next module
 * instead of as the next setting. `scripts/src/checkBrowserTestCommands.ts`
 * reads the same scripts to decide that every Playwright config is started
 * by a command, and states that reading for both checks.
 *
 * What stays out of it is decided by what the script runs rather than by a
 * list of modules to skip: `playwright test` starts a browser suite, and so
 * does a module a script runs only to hand the Playwright CLI a run — those
 * settings are declared as a `BrowserSuite` and refused in the config's
 * `globalSetup` before a spec loads, which is this same refusal one door
 * along — while `node --test` hands its files to Node's own test runner, so
 * what it names is a suite that runner collects rather than a command.
 *
 * Staying out of what must be declared is not being kept out of what may be:
 * a module that starts a run and works on its own account besides has to
 * refuse before that work, so it declares itself here and names the run it
 * starts, which is what holds it to that run's settings as well as its own.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareDeclaredSettings,
  DECLARATION_DIR,
  declaredPath,
  type DeclaredSettings,
  type EnvironmentUseProblem,
  type LocalImportProblem,
  OPTIONAL_KEY,
  OPTIONAL_LINE_KEY,
  OPTIONAL_NAME_KEY,
  readAnnouncement,
  readListExpressions,
  readObjectEntry,
  readSuiteDeclarations,
  readWorkspacePackages,
  REQUIRED_KEY,
  REQUIREMENT_MODULE,
  REQUIREMENT_PACKAGE,
  resolveNamedSettings,
  resolveSettingList,
  type SettingsProblem,
  type SettingsProblemKind,
  stringLiterals,
  type SuiteDeclaration,
  SUITE_TYPE,
  type WorkspaceImportProblem,
  type WorkspacePackageEntry,
} from "./checkBrowserTestRequirements.ts";
// The sibling check already reads what a package script runs, and reading it
// differently here is how two checks come to disagree about what a command
// does.
import {
  findModuleRuns,
  startsBrowserRun,
} from "./checkBrowserTestCommands.ts";
import {
  collectWorkspacePackages,
  type WorkspacePackage,
} from "./checkTypecheckScripts.ts";
import { stripComments } from "./playwrightConfigs.ts";

/** The type annotation marking a command declaration in the shared module. */
export const COMMAND_TYPE = "CommandRequirement";

/** The declaration key naming the module that command runs. */
export const COMMAND_KEY = "command";

/** The declaration key naming the browser run that command starts. */
export const STARTS_KEY = "starts";
/** The call a command makes before it touches anything. */
export const PREFLIGHT_FUNCTION = "requireCommandSettings";

/** A declaration named as itself, rather than built out of something. */
const DECLARATION_NAME = /^[A-Za-z_$][\w$]*$/;
/** One `CommandRequirement` declaration, as the shared module states it. */
export interface CommandDeclaration extends DeclaredSettings {
  /** Export name, which is what the command's own preflight names. */
  readonly name: string;
  /**
   * Workspace-relative path of the module it runs, or null where the
   * declaration does not name one as a plain string.
   */
  readonly module: string | null;
  /**
   * Declaration name of the browser suite it starts as a run of its own,
   * null where it starts none.
   */
  readonly starts: string | null;
  /**
   * The `starts` entry as written, where it is written as something other
   * than a plain declaration name. A command saying it starts something
   * nothing can read is held to no run at all, which is the state this
   * check reports rather than passes over.
   */
  readonly startsAsWritten: string | null;
  /**
   * The `optional` entries stating no line about going without the setting,
   * as the names they state. That line is what a reader of this declaration
   * has to go on, so an entry leaving it out states a bare name.
   */
  readonly unsaid: readonly string[];
}

export type CommandProblemKind =
  /** Its `command` is not a plain name, so no module can be read for it. */
  | "unnamed-module"
  /** The module it names is not on disk. */
  | "unresolved"
  /** That module never asks whether it may run. */
  | "silent"
  /** It asks and drops the answer, so a refusal stops nothing. */
  | "ignored-answer"
  /** It holds itself to another command's declaration. */
  | "wrong-command"
  /** Its `starts` is not the plain name of a declaration here. */
  | "unnamed-run"
  /** The run it says it starts is declared by nobody. */
  | "unknown-run"
  /** Nothing in the module it runs starts that run. */
  | "unstarted-run"
  /** That run cannot start without a setting this command does not require. */
  | "unrequired-started-setting"
  /** It states one as optional without saying what a run loses with it. */
  | "unsaid-optional"
  /** The settings comparisons every declaration is held to. */
  | SettingsProblemKind;

export interface CommandProblem {
  /** Export name of the declaration in the shared module. */
  command: string;
  /** Workspace-relative path of the module it names, where it names one. */
  module: string | null;
  kind: CommandProblemKind;
  /** The declarations its preflight names instead, for a wrong one. */
  announced?: string[];
  /** The browser run it declares it starts, as the declaration names it. */
  startedRun?: string;
  /** The config that run is, for a run this module does not start. */
  startedConfig?: string;
  /** The settings at issue, for a problem about what it declares. */
  settings?: string[];
  /** Where each of those is read, for one read but not declared. */
  readIn?: { name: string; modules: string[] }[];
  /** The parts of its settings lists this check could not read. */
  unreadable?: string[];
  /** Where it reaches the environment, for a use nothing can follow. */
  handedOn?: EnvironmentUseProblem[];
  /** The workspace imports that reached no file, so nothing read them. */
  unresolvedImports?: WorkspaceImportProblem[];
  /** The imports of a file beside one of them that reached no file. */
  unresolvedLocalImports?: LocalImportProblem[];
}

/** Whether a workspace-relative path is a file, named exactly as given. */
function fileExists(root: string, relative: string): boolean {
  try {
    return statSync(path.join(root, relative)).isFile();
  } catch {
    return false;
  }
}

/**
 * The command declarations in the shared requirement module: which module
 * each command runs, and the settings it states for it. A declaration naming
 * no module as a plain string is kept rather than skipped — it is a command
 * held to nothing, which is the state this check exists to report.
 */
export function readCommandDeclarations(source: string): CommandDeclaration[] {
  const code = stripComments(source);
  const lists = readListExpressions(code);
  const declarations: CommandDeclaration[] = [];
  const headers = code.matchAll(
    new RegExp(
      `\\bexport\\s+const\\s+([A-Za-z_$][\\w$]*)\\s*:\\s*${COMMAND_TYPE}\\s*=\\s*\\{`,
      "g",
    ),
  );
  for (const header of headers) {
    // Read from just inside the opening brace, so one declaration never
    // borrows the next one's entries.
    const body = code.slice(header.index + header[0].length);
    const named = stringLiterals(readObjectEntry(body, COMMAND_KEY) ?? "")[0];
    const starts = readObjectEntry(body, STARTS_KEY)?.trim() ?? null;
    const requiredEntry = readObjectEntry(body, REQUIRED_KEY);
    const required =
      requiredEntry === null
        ? { names: [], unreadable: [`no \`${REQUIRED_KEY}\` entry`] }
        : resolveSettingList(requiredEntry, lists);
    const optionalEntry = readObjectEntry(body, OPTIONAL_KEY);
    // Read the way a suite's are, entry by entry and for the line as well as
    // the name: a command states the same settings in the same entries. What
    // it does not do with the line is print it — a command reads these
    // settings by handing the environment to the helpers the suites hand it
    // to, and names none of them in its own output — so the line here is
    // read by whoever reads the declaration, deciding what a run without one
    // of them still does. Stating nothing optional is the ordinary case, not
    // something unreadable.
    const optional =
      optionalEntry === null
        ? { names: [], unreadable: [], unsaid: [] }
        : resolveNamedSettings(optionalEntry, lists, OPTIONAL_LINE_KEY);
    declarations.push({
      name: header[1]!,
      module: named ? declaredPath(named) : null,
      starts: starts !== null && DECLARATION_NAME.test(starts) ? starts : null,
      startsAsWritten:
        starts !== null && !DECLARATION_NAME.test(starts) ? starts : null,
      required: required.names,
      optional: optional.names,
      unsaid: optional.unsaid,
      unreadable: [
        ...required.unreadable.map((part) => `${REQUIRED_KEY}: ${part}`),
        ...optional.unreadable.map((part) => `${OPTIONAL_KEY}: ${part}`),
      ],
    });
  }
  return declarations;
}

/**
 * Whether every preflight call's answer is acted on. The function answers
 * rather than throws — these commands catch everything they do, so that a
 * provider error cannot print an address or an account id, and a throw would
 * be caught by that same handler — so a call whose answer is dropped prints
 * the notice and then deletes accounts anyway, which is worse than not asking
 * at all: the run says out loud that it cannot run, and runs.
 */
export function answerIsUsed(source: string): boolean {
  const code = stripComments(source);
  const calls = code.matchAll(new RegExp(`\\b${PREFLIGHT_FUNCTION}\\s*\\(`, "g"));
  for (const call of calls) {
    const before = code.slice(0, call.index).trimEnd();
    if ("(!=&|?:,".includes(before.at(-1) ?? "")) continue;
    if (/\breturn$/.test(before)) continue;
    return false;
  }
  return true;
}

/**
 * What is wrong with one declared command, or null when nothing is.
 *
 * `suites` are the browser suites the same module declares, which is what a
 * command's `starts` entry names.
 */
export function inspectCommand(
  root: string,
  declaration: CommandDeclaration,
  packages: ReadonlyMap<string, WorkspacePackageEntry> = readWorkspacePackages(
    root,
  ),
  suites: readonly SuiteDeclaration[] = readDeclaredSuites(root),
): CommandProblem | null {
  const shared = { command: declaration.name, module: declaration.module };
  if (declaration.module === null) return { ...shared, kind: "unnamed-module" };
  if (!fileExists(root, declaration.module))
    return { ...shared, kind: "unresolved" };

  const source = readFileSync(path.join(root, declaration.module), "utf8");
  const preflight = readAnnouncement(
    root,
    declaration.module,
    source,
    PREFLIGHT_FUNCTION,
  );
  if (!preflight.announces) return { ...shared, kind: "silent" };
  if (!answerIsUsed(source)) return { ...shared, kind: "ignored-answer" };
  if (!preflight.suites.includes(declaration.name))
    return {
      ...shared,
      kind: "wrong-command",
      announced: [...preflight.suites],
    };

  const started = inspectStartedRun(declaration, source, suites);
  if (started !== null && "kind" in started)
    return { ...shared, ...started };

  // An `optional` entry saying nothing about what the command does without
  // its setting is answered before the comparison below, which reads the
  // module and everything it imports: this one is the declaration by itself
  // and needs nothing read. A list whose names cannot be read comes first
  // even so — that one is reported from the comparison, and a command held
  // to a list nobody can see is the worse of the two to leave standing.
  if (declaration.unreadable.length === 0 && declaration.unsaid.length > 0)
    return {
      ...shared,
      kind: "unsaid-optional",
      settings: [...declaration.unsaid],
    };

  // Asking is settled; whether the list it asks for is the one this command
  // reads is the same question a suite's spec is held to, so it is the same
  // comparison, run over the module this command starts from. A command
  // starting a run of its own answers for the environment it hands that run
  // -- by the suite named above, whose own settings are declared and
  // checked -- so a spread of the environment in this module is accounted
  // for rather than reported.
  const settings = compareDeclaredSettings(
    root,
    declaration.module,
    declaration,
    packages,
    undefined,
    undefined,
    started === null ? undefined : { module: declaration.module },
  );
  return settings === null ? null : { ...shared, ...settings };
}

/** The browser suites declared beside the commands in the shared module. */
function readDeclaredSuites(root: string): SuiteDeclaration[] {
  if (!fileExists(root, REQUIREMENT_MODULE)) return [];
  return readSuiteDeclarations(
    readFileSync(path.join(root, REQUIREMENT_MODULE), "utf8"),
  );
}

/** A package script running a module someone starts by hand. */
export interface CommandScript {
  /** Workspace-relative directory of the package declaring that script. */
  dir: string;
  /** The script's name in that package.json. */
  script: string;
  /** Workspace-relative path of the module it runs. */
  module: string;
}

/**
 * The `command` name a declaration for that module would state: a bare name
 * for a file in the directory these commands live in, its workspace-relative
 * path for one below that directory, the way `declaredPath` reads either.
 */
function nameFor(module: string): string {
  const inside = module.slice(`${DECLARATION_DIR}/`.length);
  return inside.includes("/") ? module : inside;
}

/**
 * Every package script that runs one of these commands by hand: a module in
 * the directory they live in, handed to `node` (or another runner of this
 * workspace's modules) as the thing to run.
 *
 * Three things a script may run are not that, and each is left out by what
 * the script runs rather than by the module's name: a module the runner is
 * told to collect instead of start, which is `node --test`; a module that
 * hands the Playwright CLI a run of its own, which makes it a browser
 * suite's launcher, held to that suite's `BrowserSuite` declaration in the
 * config's `globalSetup`; and a module this check cannot read at all, which
 * states nothing either way and is reported by nothing here.
 */
export function findCommandScripts(
  root: string,
  packages: WorkspacePackage[] = collectWorkspacePackages(root),
): CommandScript[] {
  const scripts: CommandScript[] = [];
  for (const run of findModuleRuns(root, packages)) {
    if (run.collectedAsTest) continue;
    if (!run.module.startsWith(`${DECLARATION_DIR}/`)) continue;
    let source;
    try {
      source = readFileSync(path.join(root, run.module), "utf8");
    } catch {
      continue;
    }
    if (startsBrowserRun(source)) continue;
    scripts.push({ dir: run.dir, script: run.script, module: run.module });
  }
  return scripts.sort((left, right) =>
    `${left.dir} ${left.script}`.localeCompare(`${right.dir} ${right.script}`),
  );
}

/**
 * The scripts running a command no declaration names, which is the one thing
 * here a declaration cannot report about itself.
 */
export function formatUndeclared(
  scripts: CommandScript[],
  exemplar: string,
): string {
  const one = scripts.length === 1;
  const lines = [
    `${scripts.length} package script${one ? "" : "s"} run${one ? "s" : ""} a module in ${DECLARATION_DIR} that no ${COMMAND_TYPE} in ${REQUIREMENT_MODULE} names:`,
    "",
  ];
  for (const script of scripts) {
    lines.push(
      `  ${script.dir}/package.json → "${script.script}"`,
      `      runs: ${script.module}`,
      `      problem: someone runs that module by hand and no declaration names it, so it is held to no settings at all — a missing one surfaces as a throw partway through what it does, which is the failure every declared command is here to replace`,
      `      fix: declare it in ${REQUIREMENT_MODULE} as a`,
      `           ${COMMAND_TYPE} stating \`${COMMAND_KEY}: "${nameFor(script.module)}"\` and the`,
      "           settings it cannot run without, then start that module with",
      `           \`if (!${PREFLIGHT_FUNCTION}(<that declaration>)) process.exitCode = 1;\`;`,
      `           ${exemplar} is the shape to copy. If the script runs it only`,
      "           to start a browser suite, that suite's config declares those",
      "           settings instead, and this stops asking.",
      "",
    );
  }
  return lines.join("\n");
}

const WHY = [
  "Why: these commands are reached by no Playwright config and no spec, so nothing",
  "held them to a list of settings at all. Each hands the whole environment to the",
  "same disposable-account recovery helpers the moderation fixture uses, and a",
  "setting one of them needs that an environment does not provide used to surface",
  "as a throw partway through — with the database pool already open and the",
  "provider already asked for the moderator accounts the sweep must not delete —",
  "caught by the command's own handler, which prints no provider details, and so",
  "read as the recovery having failed rather than as a setting to set.",
  "",
  `Each command therefore states what it cannot run without on a ${COMMAND_TYPE}`,
  `in ${REQUIREMENT_MODULE}, beside the`,
  `browser suites' settings, and calls ${PREFLIGHT_FUNCTION}(<its own`,
  "declaration>) before it opens anything. A run missing one is refused by name,",
  "having created and deleted nothing. The answer has to be acted on: the call",
  "answers rather than throws, because these commands catch everything they do,",
  "so a dropped answer prints the notice and deletes accounts anyway.",
  "",
  "The declared list is then held to what the command reads, in both directions,",
  "the way a suite's is. A setting read but declared neither way is the same",
  "failure one call further in — the command starts, then throws for a setting",
  "nothing named — and a declared setting nothing reads any more refuses a run",
  `over something nobody has to configure. Handing the environment to a helper`,
  "counts as reading whatever that helper reads, so a handoff nothing can follow",
  "is reported rather than passed over, and so is an import of a package this",
  "workspace builds that reaches no file, or a path to a file beside the",
  "importing one that reaches nothing at all.",
  "",
  `Each \`${OPTIONAL_KEY}\` entry states, as \`${OPTIONAL_LINE_KEY}\`, what the command does`,
  "without that setting. A suite prints that line beside every name its run went",
  "without; a command prints none of them, on purpose — the entries here are the",
  "recovery sweep's, and an unset pair is the development run that sweep insists",
  "on rather than a gap — so the line is read where the declaration is, by",
  "whoever is deciding what to set before running one of these by hand. An entry",
  "stating no line, or a blank one, fails here: a name on its own says the",
  "command starts without it and nothing about what it then leaves undone. What",
  "the line says is nobody's business here; that there is one is.",
  "",
  "Which modules are commands is read from the package scripts, because the",
  `directory they live in also holds the browser suites, their fixtures and the`,
  "recovery tests, and a name tells them apart from none of those. A script",
  "running one with `node` is the evidence someone runs it by hand, so a module",
  "run that way and declared nowhere is reported as well — otherwise the gap this",
  "check closes arrives again as the next module rather than as the next setting.",
  "A script starting a browser suite is not one of these, whether it starts it",
  "directly or through a module that does: that suite states its settings where",
  "it is declared, and its run is refused in the config's `globalSetup`.",
  "",
  "A module that starts such a run and works on its own account besides — before",
  "the run, and after it, on the accounts that run must leave untouched — is",
  "declared here all the same, because its own refusal has to come before that",
  "work rather than one door along. It hands the run the whole environment, and",
  "what the run reads is read in another process, so",
  `\`${STARTS_KEY}\` names the ${SUITE_TYPE} declared for that run: those`,
  "settings are held to the config and spec it loads, and this command is held to",
  "require everything the run cannot start without. A setting it comes to need is",
  "then refused here by name, rather than thrown inside a child process whose",
  "output this command never prints.",
].join("\n");

/** The line naming what is wrong, in the reader's terms. */
function explain(problem: CommandProblem): string {
  const command = problem.command;
  switch (problem.kind) {
    case "unnamed-module":
      return `its \`${COMMAND_KEY}\` is not a plain module name, so nothing can be read for it and this command is held to no settings at all`;
    case "unresolved":
      return `it names ${problem.module} as the module it runs, and that file is not there`;
    case "silent":
      return `${problem.module} never calls ${PREFLIGHT_FUNCTION}() from ${REQUIREMENT_PACKAGE}, so a missing setting still surfaces as a throw partway through it`;
    case "ignored-answer":
      return `${problem.module} calls ${PREFLIGHT_FUNCTION}() and does nothing with the answer, so a run missing a setting prints the refusal and then goes on anyway`;
    case "wrong-command": {
      const announced = problem.announced ?? [];
      return announced.length === 0
        ? `${problem.module} holds itself to a declaration ${REQUIREMENT_MODULE} does not export`
        : `${problem.module} holds itself to ${[...new Set(announced)].join(" and ")}, which is another command's settings`;
    }
    case "unnamed-run":
      return `its \`${STARTS_KEY}\` is written as ${problem.startedRun}, which is not the plain name of a ${SUITE_TYPE} declared here, so the run it starts is held to nothing and neither is what this command hands that run`;
    case "unknown-run":
      return `it states it starts ${problem.startedRun}, and ${REQUIREMENT_MODULE} declares no ${SUITE_TYPE} by that name — so the settings of the run it starts are stated nowhere`;
    case "unstarted-run":
      return `it states it starts ${problem.startedRun}, and nothing in ${problem.module} names ${problem.startedConfig}, the config that run is made from — so whatever this command hands the whole environment to, it is not that run`;
    case "unrequired-started-setting": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `the ${problem.startedRun} run it starts cannot start without ${names.join(", ")}, and ${command} does not require ${one ? "it" : "them"} — so a run missing ${one ? "it" : "them"} is refused inside the child process this command starts, whose output it never prints`;
    }
    case "unreadable-settings":
      return `its settings are not written as plain names this check can read (${(problem.unreadable ?? []).join("; ")}), so nothing holds the command to them`;
    case "unresolved-local-import": {
      const unresolved = problem.unresolvedLocalImports ?? [];
      const one = unresolved.length === 1;
      const named = [
        ...new Set(unresolved.map((entry) => entry.specifier)),
      ].join(", ");
      return `what ${problem.module} runs imports ${named}, ${one ? "a path" : "paths"} naming no file here — so this command stops as it loads, and whatever ${one ? "that file read" : "those files read"} is missing from what ${command} is held to`;
    }
    case "unresolved-workspace-import": {
      const unresolved = problem.unresolvedImports ?? [];
      const one = unresolved.length === 1;
      const named = [
        ...new Set(unresolved.map((entry) => entry.package)),
      ].join(", ");
      return `${problem.module} imports ${named}, ${one ? "a package" : "packages"} this workspace builds, by ${one ? "a specifier" : "specifiers"} reaching no file here — so whatever ${one ? "it reads" : "they read"} is missing from what ${command} is held to`;
    }
    case "unreadable-environment": {
      const handed = problem.handedOn ?? [];
      const one = handed.length === 1;
      return `it reaches the environment in ${one ? "a place" : "places"} this check cannot follow to setting names, so whatever ${one ? "that reaches" : "those reach"} is read by this command without ${command} having to declare it`;
    }
    case "undeclared-setting": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `it reads ${names.join(", ")}, which ${command} declares neither as \`${REQUIRED_KEY}\` nor as \`${OPTIONAL_KEY}\`, so the command starts and then throws for ${one ? "a setting nobody said was" : "settings nobody said were"} missing`;
    }
    case "unread-required": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `${command} requires ${names.join(", ")}, and nothing it runs reads ${one ? "it" : "them"} any more, so the command refuses to start over ${one ? "a setting" : "settings"} nobody here needs`;
    }
    case "unread-optional": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `${command} states ${names.join(", ")} as \`${OPTIONAL_KEY}\`, and nothing it runs reads ${one ? "it" : "them"} any more`;
    }
    case "unsaid-optional": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `${command} states ${names.join(", ")} as \`${OPTIONAL_KEY}\` with no \`${OPTIONAL_LINE_KEY}\` line, so the declaration says this command reads ${one ? "it" : "them"} and will start without ${one ? "it" : "them"}, and nothing about what the run then does — which is all a person deciding whether to set ${one ? "it" : "them"} has to go on, this command naming none of them in its own output`;
    }
  }
}

/** What to do about it. */
function fix(problem: CommandProblem): string[] {
  const indented = (lines: readonly string[]): string[] => [
    ...lines.map((line, index) =>
      index === 0 ? `      fix: ${line}` : `           ${line}`,
    ),
    "",
  ];
  switch (problem.kind) {
    case "unnamed-module":
    case "unresolved":
      return indented([
        `name the module this command runs as \`${COMMAND_KEY}\` on ${problem.command} in`,
        `${REQUIREMENT_MODULE}, as a plain string:`,
        `a bare name for a file in ${DECLARATION_DIR}/, its workspace-relative`,
        "path anywhere else.",
      ]);
    case "silent":
    case "ignored-answer":
      return indented([
        `start that module with \`if (!${PREFLIGHT_FUNCTION}(${problem.command})) process.exitCode = 1;\``,
        `— both imported from ${REQUIREMENT_PACKAGE} — and run the rest`,
        "only when it answers true, so the settings it is missing are named before it",
        "opens the database or reaches the provider.",
      ]);
    case "wrong-command":
      return indented([
        `hand ${PREFLIGHT_FUNCTION}() this command's own declaration, ${problem.command}, or`,
        `correct the \`${COMMAND_KEY}\` named on the declarations in`,
        `${REQUIREMENT_MODULE} if the two are the other`,
        "way round.",
      ]);
    case "unnamed-run":
    case "unknown-run":
      return indented([
        `name the run this command starts as \`${STARTS_KEY}\` on ${problem.command} in`,
        `${REQUIREMENT_MODULE}: the ${SUITE_TYPE}`,
        "declared there for that Playwright config, written as its plain name — or",
        "drop the entry, if this command starts no browser run of its own. Until it",
        "names one, the environment this command spreads into a child process is a",
        "gap in what it is held to.",
      ]);
    case "unstarted-run":
      return indented([
        `start ${problem.startedConfig} from ${problem.module}, or name the run it`,
        `really starts as \`${STARTS_KEY}\` on ${problem.command} in`,
        `${REQUIREMENT_MODULE} — and drop the entry`,
        "if it starts none any more, so that nothing accounts for an environment it",
        "hands somewhere else.",
      ]);
    case "unrequired-started-setting":
      return indented([
        `add ${(problem.settings ?? []).join(", ")} to \`${REQUIRED_KEY}\` on ${problem.command} in`,
        `${REQUIREMENT_MODULE}, so this command`,
        `refuses by name before it starts ${problem.startedRun} — or take ${(problem.settings ?? []).length === 1 ? "it" : "them"} off`,
        `that suite's \`${REQUIRED_KEY}\`, if the run no longer needs ${(problem.settings ?? []).length === 1 ? "it" : "them"}.`,
      ]);
    case "undeclared-setting":
      return indented([
        `add ${(problem.settings ?? []).join(", ")} to \`${REQUIRED_KEY}\` on ${problem.command} in`,
        `${REQUIREMENT_MODULE}, so a run missing`,
        `${(problem.settings ?? []).length === 1 ? "it" : "them"} is refused by name — or, where the command really may run without`,
        `one, name it in \`${OPTIONAL_KEY}\` there and say in a comment why.`,
      ]);
    case "unread-required":
      return indented([
        `drop ${(problem.settings ?? []).join(", ")} from \`${REQUIRED_KEY}\` on ${problem.command} in`,
        `${REQUIREMENT_MODULE}, or move it to`,
        `\`${OPTIONAL_KEY}\` if the command still reads it sometimes. A stale \`${REQUIRED_KEY}\``,
        "entry refuses a run that would have worked.",
      ]);
    case "unread-optional":
      return indented([
        `drop ${(problem.settings ?? []).join(", ")} from \`${OPTIONAL_KEY}\` on ${problem.command} in`,
        `${REQUIREMENT_MODULE}.`,
      ]);
    case "unsaid-optional": {
      const names = (problem.settings ?? []).join(", ");
      const one = (problem.settings ?? []).length === 1;
      return indented([
        `write what this command does without ${names} as the \`${OPTIONAL_LINE_KEY}\``,
        `of ${one ? "that entry" : "those entries"}, stated in \`${OPTIONAL_KEY}\` on ${problem.command} or in a list it`,
        `spreads, in ${REQUIREMENT_MODULE} —`,
        `\`{ ${OPTIONAL_NAME_KEY}: "...", ${OPTIONAL_LINE_KEY}: "..." }\` — in one short line and in the run's`,
        'terms: what the command does instead, not that the variable is unset. "nothing"',
        "is an answer, and a useful one, since it says this run did as much as a fully",
        `configured one would. \`${OPTIONAL_LINE_KEY}: ""\` states the bare name the line was`,
        "added to replace: that the command runs without it, and nothing about what it",
        "then does.",
      ]);
    }
    case "unreadable-settings":
      return indented([
        `write that command's \`${REQUIRED_KEY}\` in`,
        `${REQUIREMENT_MODULE} as string literals`,
        `and its \`${OPTIONAL_KEY}\` as entries stating a literal \`${OPTIONAL_NAME_KEY}\` — either`,
        "list may also spread a constant array declared in that same module, which",
        "is how both commands state the recovery sweep's settings — so what the",
        "command is held to can be read from it.",
      ]);
    case "unresolved-local-import":
      return indented([
        "restore that file, or correct the import to the name it has now — the module",
        "writing it is named above. Until it resolves, what that file read is missing",
        "from both comparisons, so neither list on this command is held to anything.",
      ]);
    case "unresolved-workspace-import":
      return indented([
        "point that package's `exports` (or `main`) at a file this repository has —",
        "its source, not built output a fresh checkout does not carry. Until it",
        "resolves, what it reads is missing from both comparisons, so neither list",
        "on this command can be trusted.",
      ]);
    case "unreadable-environment":
      return indented([
        "write each setting's name out where it is read, rather than building it at",
        "run time, and hand a helper the environment directly in the call — the",
        `\`env: process.env\` a call is given inside its own arguments is followed,`,
        "one kept in an object built beforehand is not.",
      ]);
  }
}

export function formatProblems(problems: CommandProblem[]): string {
  const one = problems.length === 1;
  const lines = [
    `${problems.length} command${one ? "" : "s"} declared in ${REQUIREMENT_MODULE} ${one ? "does" : "do"} not state the settings ${one ? "it" : "they"} cannot run without:`,
    "",
  ];
  for (const problem of problems) {
    lines.push(`  ${problem.command}`);
    if (problem.module !== null) lines.push(`      runs: ${problem.module}`);
    if (problem.startedConfig !== undefined)
      lines.push(`      starts: ${problem.startedConfig}`);
    lines.push(`      problem: ${explain(problem)}`);
    for (const read of problem.readIn ?? []) {
      lines.push(`      ${read.name} is read in: ${read.modules.join(", ")}`);
    }
    for (const handed of problem.handedOn ?? []) {
      lines.push(`      ${handed.module}: ${handed.use}`);
      lines.push(`          ${handed.reason}`);
    }
    for (const unresolved of [
      ...(problem.unresolvedLocalImports ?? []),
      ...(problem.unresolvedImports ?? []),
    ]) {
      lines.push(`      ${unresolved.module}: imports ${unresolved.specifier}`);
      lines.push(`          ${unresolved.reason}`);
    }
    lines.push(...fix(problem));
  }
  return lines.join("\n");
}

export function checkWorkspace(root: string): string | null {
  if (!fileExists(root, REQUIREMENT_MODULE)) {
    return [
      `${REQUIREMENT_MODULE} is no longer there.`,
      "",
      `Each command run by hand states the settings it cannot run without on a`,
      `${COMMAND_TYPE} in that file, and refuses through`,
      `${PREFLIGHT_FUNCTION}() from ${REQUIREMENT_PACKAGE}. Restore it, or`,
      "name its new path in scripts/src/checkBrowserTestRequirements.ts and in",
      "the modules that import it.",
      "",
      WHY,
    ].join("\n");
  }

  const declarations = readCommandDeclarations(
    readFileSync(path.join(root, REQUIREMENT_MODULE), "utf8"),
  );
  if (declarations.length === 0) {
    return [
      `No ${COMMAND_TYPE} in ${REQUIREMENT_MODULE} names a command.`,
      "",
      "That is reported as a failure on purpose: with nothing declared, this",
      "check passes exactly the way a workspace whose commands all name their",
      "settings does. The commands that delete disposable accounts are run by",
      "hand, reached by no config and no spec, so a declaration is the only",
      "thing standing between a missing setting and a throw partway through",
      "one of them.",
      "",
      WHY,
    ].join("\n");
  }

  const packages = readWorkspacePackages(root);
  const suites = readDeclaredSuites(root);
  const problems: CommandProblem[] = [];
  for (const declaration of declarations) {
    const problem = inspectCommand(root, declaration, packages, suites);
    if (problem !== null) problems.push(problem);
  }

  // The other direction: a module someone runs by hand that no declaration
  // above names is held to nothing at all, which no declaration can report.
  const declared = new Set(
    declarations
      .map((declaration) => declaration.module)
      .filter((module): module is string => module !== null),
  );
  const undeclared = findCommandScripts(root).filter(
    (script) => !declared.has(script.module),
  );

  const sections: string[] = [];
  if (problems.length > 0) {
    problems.sort((left, right) => left.command.localeCompare(right.command));
    sections.push(formatProblems(problems));
  }
  if (undeclared.length > 0) {
    sections.push(formatUndeclared(undeclared, declarations[0]!.name));
  }
  if (sections.length === 0) return null;
  return [...sections, WHY].join("\n");
}

function main(): void {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const failure = checkWorkspace(root);
  if (failure) {
    console.error(`\nCommand requirement convention violated\n\n${failure}\n`);
    process.exitCode = 1;
    return;
  }
  const declarations = readCommandDeclarations(
    readFileSync(path.join(root, REQUIREMENT_MODULE), "utf8"),
  );
  console.log(
    `All ${declarations.length} command${declarations.length === 1 ? "" : "s"} declared in ${REQUIREMENT_MODULE} name the settings they cannot run without before they touch an account, and each of those lists is what the command reads.`,
  );
  const scripts = findCommandScripts(root);
  console.log(
    `Every package script that runs a module in ${DECLARATION_DIR} by hand names one of those declarations: ${scripts.length} script${scripts.length === 1 ? "" : "s"}.`,
  );
}

// Only when this file is the command being run: a unit suite imports the
// checks above rather than starting one.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}

/**
 * The run a command declares it starts: the suite itself where the
 * declaration holds up, what is wrong with it where it does not, and null
 * where the command declares no run at all.
 *
 * Three things have to hold for a `starts` entry to be worth what it
 * excuses. It has to name a suite declared here, or nothing is known about
 * the run; the module has to really start that run, or the environment it
 * spreads goes somewhere else entirely; and this command has to require
 * everything the run cannot start without, which is the whole point of
 * declaring it -- a missing setting is then named by this command, before
 * the run, rather than thrown inside a child process whose output this
 * command never prints.
 */
function inspectStartedRun(
  declaration: CommandDeclaration,
  source: string,
  suites: readonly SuiteDeclaration[],
):
  | SuiteDeclaration
  | (Pick<CommandProblem, "kind" | "startedRun" | "startedConfig" | "settings">)
  | null {
  if (declaration.startsAsWritten !== null)
    return { kind: "unnamed-run", startedRun: declaration.startsAsWritten };
  if (declaration.starts === null) return null;

  const started = suites.find((suite) => suite.suite === declaration.starts);
  if (started === undefined)
    return { kind: "unknown-run", startedRun: declaration.starts };

  // The config is how Playwright is told which run to make, so a module that
  // starts this one names it. Reading the name out of the module keeps the
  // declaration from outliving the run it describes: a verifier pointed at
  // another config, or one that stops starting a run at all, no longer
  // accounts for the environment it hands on.
  const config = path.posix.basename(started.config);
  if (!stripComments(source).includes(config))
    return {
      kind: "unstarted-run",
      startedRun: declaration.starts,
      startedConfig: config,
    };

  const required = new Set(declaration.required);
  const missing = started.required.filter((name) => !required.has(name));
  if (missing.length > 0)
    return {
      kind: "unrequired-started-setting",
      startedRun: declaration.starts,
      settings: missing,
    };
  return started;
}
