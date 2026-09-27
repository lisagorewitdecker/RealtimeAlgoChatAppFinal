/**
 * Whether a run of this workspace's browser suites may go without the
 * settings they sign in with, and how that decision is announced.
 *
 * Every package reaches this the same way it reaches any other shared
 * library, by its package name: `@workspace/browser-test-requirements`. The
 * convention it carries is the workspace's — every Playwright config in the
 * tree is held to it by `scripts/src/checkBrowserTestRequirements.ts` — so a
 * browser suite added in another artifact declares itself here and announces
 * through here, rather than reaching into the package these suites happened
 * to start in.
 *
 * The Playwright suites used to skip themselves whenever a URL, a Clerk
 * development key, or a moderator's credentials were absent, and a skipped
 * browser check reports the same green as a passing one. Banning, granting
 * moderator access, and the moderation history could therefore have gone
 * unverified -- in the run made before publishing -- with nobody told.
 *
 * A missing setting is treated as a broken environment rather than as less to
 * check: an environment set up to drive these suites is meant to provide all
 * of them, and a partly configured one is exactly what produced the quiet
 * pass. Going without has to be said out loud, and a run that does still
 * reports what it left out.
 *
 * Each browser config names a one-line module as Playwright's `globalSetup`,
 * and that module calls `announceBrowserTests` here. Playwright runs
 * `globalSetup` once, in the run's own process, before it loads any spec file,
 * so the decision is made once and lands in the run output rather than in a
 * report someone has to open:
 *
 * - every setting present -- the suite runs.
 * - any setting missing -- the whole run fails, naming the ones to set.
 * - `BROWSER_TESTS=skip` -- the suite is left out and the run says so.
 *
 * A suite may also state a setting as optional, and a run going ahead without
 * one names it as well. Those cases read it, so a run made without it is not
 * the run a fully configured one makes, and unsaid it would print the same
 * output either way -- the quiet pass above, arriving one suite at a time.
 * Each optional entry carries the line saying what its cases do without it,
 * and the announcement prints that line beside the name, the way a waived run
 * prints what it leaves out: a bare name says a run went without something
 * without saying what that cost it, and leaves the reader to open the spec to
 * find out whether it cost a case or nothing at all.
 *
 * The waiver wins even when everything is configured, because these suites
 * sign in as real administrator accounts and write moderation history: "no
 * browser checks are expected here" has to be able to mean "do not touch
 * them". A waived run therefore reaches nothing outside itself -- the config
 * drops the step that asks Clerk for a testing token along with the suite it
 * serves, and the specs declare their skip as they are collected, before a
 * browser is launched or a disposable account is created.
 *
 * Only variable names are ever printed. The moderator credentials are among
 * them, and a notice that named a value would be a worse leak than the gap it
 * reports.
 */

/** Declares what this environment is supposed to provide. */
export const BROWSER_TESTS_ENV_VAR = "BROWSER_TESTS";

/** Default: these checks are expected, so a missing setting fails the run. */
export const BROWSER_TESTS_REQUIRED = "required";

/** Waiver: no browser checks are expected here, so the suite may be left out. */
export const BROWSER_TESTS_SKIP = "skip";

/** Every accepted `BROWSER_TESTS` value, compared trimmed and lower-cased. */
export const BROWSER_TESTS_VALUES: readonly string[] = [
  BROWSER_TESTS_REQUIRED,
  BROWSER_TESTS_SKIP,
];

/** The keys `global.setup.ts` needs to obtain a Clerk testing token. */
export const CLERK_KEY_ENV_VARS: readonly string[] = [
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
];

/**
 * What every browser suite here needs: where the app and API are, the Clerk
 * development instance they authenticate against, and the database they read
 * their results from and clean their disposable rows out of.
 */
export const BROWSER_PREREQUISITE_ENV_VARS: readonly string[] = [
  "E2E_CHAT_URL",
  "E2E_API_URL",
  ...CLERK_KEY_ENV_VARS,
  "DATABASE_URL",
];

/** The administrator accounts the moderation suite signs in as. */
export const MODERATOR_CREDENTIAL_ENV_VARS: readonly string[] = [
  "E2E_MODERATOR_EMAIL",
  "E2E_MODERATOR_PASSWORD",
  "E2E_MODERATOR_EMAIL_2",
  "E2E_MODERATOR_PASSWORD_2",
];

/**
 * One setting a suite's cases read that a run may go without, and what those
 * cases do when it is absent.
 *
 * The line is what makes the entry worth printing. "Going without
 * MODERATION_TIMEOUT_RECORD" names a gap without measuring it: the reader
 * cannot tell from the name whether the run lost a case or carried on
 * unchanged, and has to open the spec to find out. The line answers that in
 * the run's own output, the way a waived run's `covers` list does.
 *
 * It is prose written here, never anything read out of the environment. The
 * announcement prints these lines and variable names, and no value of
 * anything.
 */
export interface OptionalSetting {
  /** The variable name, as the environment would provide it. */
  readonly name: string;
  /**
   * What this suite's cases do without it, in one short line and in the
   * run's terms rather than the setting's: what happens to the cases, not
   * that the variable is unset. "nothing" is an answer, and a useful one --
   * it says the run covered as much as a fully configured one would.
   */
  readonly without: string;
}

/**
 * One setting a suite states its cases are meant never to reach, and why.
 *
 * `optional` is the wrong home for a setting a run never wants: an entry no
 * environment provides prints a gap on every run, and a notice that is always
 * there is one its readers learn to skip -- the quiet pass this module exists
 * to prevent. But nothing keeps a suite out of that home by itself. The check
 * reading these lists follows every module a spec imports, at any scope, so
 * one import of a helper serving another suite puts that helper's settings
 * among this suite's reads, and the quickest way to make the resulting
 * failure go away is to declare the setting optional and live with the line.
 *
 * Naming it here refuses that. A setting stated this way may appear in
 * neither `required` nor `optional`, and nothing the spec or the config
 * imports may read it: the check names the module that did and says to keep
 * that module out of this spec's imports, which is the fix a split was made
 * for. Deleting the entry is still possible, and is the point -- it is one
 * deliberate line removed beside the reason for it, rather than a setting
 * quietly added to a list nobody rereads.
 *
 * Only settings this workspace's other browser runs really use belong here.
 * An entry for something nothing here provides guards against nothing, and
 * is refused as such: the check reads the whole tree for the name, so one
 * that is mistyped, or that has outlived the code it was written about,
 * fails instead of sitting in the list reading like protection.
 */
export interface UnusedSetting {
  /** The variable name, as the environment would provide it. */
  readonly name: string;
  /**
   * Why these cases do not read it, and what declaring it would cost this
   * run's output. Prose for whoever hits the failure, so it says where the
   * code needing that setting lives instead.
   */
  readonly why: string;
}
/**
 * What the disposable-account recovery sweep reads, which the moderation
 * fixture reaches by handing it `process.env` whole rather than by naming
 * any of these itself.
 *
 * None of them is a setting a run is expected to provide, which is why they
 * are declared optional wherever that sweep runs. The first two are how the
 * sweep refuses to touch a deployment -- an unset pair is what a development
 * run looks like, so requiring them would fail every ordinary run -- and the
 * third is the administrator list some deployments configure, which the
 * sweep excludes from deletion on top of the moderator accounts it resolves
 * through Clerk either way.
 */
export const RECOVERY_SWEEP_OPTIONAL: readonly OptionalSetting[] = [
  {
    name: "NODE_ENV",
    without: "the disposable-account sweep reads this as a development run",
  },
  {
    name: "REPLIT_DEPLOYMENT",
    without: "nothing marks this a deployment either, so that sweep goes on",
  },
  {
    name: "ADMIN_USER_IDS",
    without: "that sweep spares only the moderators it resolves through Clerk",
  },
];

export interface BrowserSuite {
  /** Named in the run output, so a notice says which checks it is about. */
  readonly label: string;
  /**
   * The Playwright config that runs this suite: a bare name for a config in
   * `artifacts/api-server/e2e`, where these suites live, or a
   * workspace-relative path for one in another package. A bare name is only
   * ever looked for in that one directory, so it is the name a suite
   * declared from anywhere else writes out in full.
   *
   * Stated here so a config, the spec it runs, and the settings that
   * spec cannot do without are named together in one place a person reads,
   * rather than being taken on trust from matching file names --
   * `playwright.config.ts` runs `banned-room.spec.ts`, so those names do not
   * always match in the first place.
   *
   * The pairing is what a copied config gets wrong. Each of these configs was
   * started from another one, and one left pointing at that one's
   * `<suite>.requirement.ts` announces the wrong suite: the launch smoke
   * config wired to `auth-layout.requirement.ts` would ask only for
   * `E2E_CHAT_URL` and then fail somewhere inside a case for a missing Clerk
   * key, reading as a broken product rather than a missing setting.
   * `scripts/src/checkBrowserTestRequirements.ts` holds every config in the
   * workspace to what is declared here.
   */
  readonly config: string;
  /**
   * The spec file that config runs -- the one file its `testMatch` may
   * collect. A bare name here is read beside the config named above rather
   * than in any one directory, so a suite in another package names its
   * config once and keeps this short; that is where Playwright collects it
   * from as well, since `testDir` defaults to the config's own directory. A
   * name holding a `/` is a workspace-relative path, as for the config.
   *
   * A config reaching another
   * suite's spec would run those cases on this suite's settings rather than
   * the ones declared for them, which is the same missing setting surfacing
   * inside a case, so that is checked here as well.
   */
  readonly spec: string;
  /**
   * What this suite cannot run without: a missing one fails the run here,
   * before any spec file loads.
   *
   * This has to cover everything the spec, the fixtures it imports, and the
   * workspace packages those import read out of the environment, or the gap
   * simply moves. A case reading `E2E_API_URL` under a suite asking only for
   * `E2E_CHAT_URL` starts a run that then fails inside the case, for a
   * setting nothing said was missing — the failure this module exists to
   * replace, arriving from the settings side instead of the wiring side.
   * `DATABASE_URL` is here for the same reason under the other name: no spec
   * mentions it, `@workspace/db` reads it as it loads.
   *
   * It has to cover no more than that either. An entry nothing those files
   * read any more stops the run before any case loads and sends someone off
   * to configure a setting this suite does not use, which is the same wasted
   * trip a missing one causes, pointing the other way.
   * `scripts/src/checkBrowserTestRequirements.ts` holds this list to what
   * those files actually read, in both directions.
   */
  readonly required: readonly string[];
  /**
   * Settings those same files read that a run really may go without, stated
   * so the gap is a decision rather than an omission nobody noticed. Nothing
   * is checked for these; they are the difference between "this suite does
   * not need it" and "someone forgot to ask for it", and the check above
   * refuses a setting named in neither list.
   *
   * A run may go without one, but not quietly: the ones this environment
   * does not provide are named in the announcement, because the cases read
   * them and a run that covered less would otherwise look like one that
   * covered everything. Each entry therefore states what its cases do
   * without it as well as its name, since the name alone reports that a gap
   * exists without saying what fell into it -- which is what `covers` is for
   * on the other side of the same problem, where a waived run says what it
   * left unverified rather than only that it was waived. That an entry has
   * that line is held by the same check: a blank one prints the bare name it
   * was written to replace, so the check refuses it, wherever the entry is
   * stated.
   */
  readonly optional?: readonly OptionalSetting[];
  /**
   * Settings this suite's cases are meant never to reach, each beside the
   * reason they do not. Nothing else about the suite may contradict it: a
   * name stated here may appear in neither `required` nor `optional`, and
   * nothing the spec or the config imports may read it.
   *
   * This is what keeps a split from quietly closing back up. Where a suite
   * needs part of another one's fixture, the answer is to move the code the
   * two do not share into a module of its own rather than to widen this
   * suite's lists -- and nothing records that afterwards, so the next import
   * of the whole fixture reads as one setting undeclared, which `optional`
   * makes go away in one line. An entry here turns that back into the
   * failure it is, naming the module that reintroduced the read.
   * `scripts/src/checkBrowserTestRequirements.ts` holds all three lists to
   * what the suite's files do, and this one to naming a setting this
   * workspace still has: an entry no module here reads and no suite asks
   * for refuses a read nothing could make, so it fails there rather than
   * standing as a rule holding nobody to anything.
   */
  readonly unused?: readonly UnusedSetting[];
  /** What goes unverified when it is left out, one item per line. */
  readonly covers: readonly string[];
}

export const BANNED_ROOM_SUITE: BrowserSuite = {
  label: "Banned-room browser checks",
  config: "playwright.config.ts",
  spec: "banned-room.spec.ts",
  required: BROWSER_PREREQUISITE_ENV_VARS,
  covers: [
    "what a banned member is shown in a room, and again on returning to it",
    "the signed-in chat and assistant surfaces inside a narrow browser",
  ],
};

export const MODERATION_SUITE: BrowserSuite = {
  label: "Moderation browser checks",
  config: "playwright.moderation.config.ts",
  spec: "moderation.spec.ts",
  required: [
    ...BROWSER_PREREQUISITE_ENV_VARS,
    ...MODERATOR_CREDENTIAL_ENV_VARS,
  ],
  optional: [...RECOVERY_SWEEP_OPTIONAL],
  covers: [
    "banning and restoring an account from the moderation panel",
    "granting and revoking moderator access, in the panel and in a room",
    "the refusal of an ordinary member's search and ban requests",
    "the moderation history, its filters, and its paging",
    "opening the room manager from the profile screen and dismissing it again",
  ],
};

/**
 * The signed-out screens, measured in a narrow browser at 1.4x text. These
 * cases never sign in, so the app's URL is all they cannot do without.
 */
export const AUTH_LAYOUT_SUITE: BrowserSuite = {
  label: "Sign-in layout browser checks",
  config: "playwright.auth-layout.config.ts",
  spec: "auth-layout-visual.spec.ts",
  required: ["E2E_CHAT_URL"],
  covers: [
    "the sign-in and sign-up controls staying readable and reachable at 1.4x text",
    "the email verification step of both of those paths, at the same text size",
  ],
};

/**
 * The call and sandbox documents, rendered in a phone-sized window with a
 * home bar emulated under them. The run reaches nothing outside itself: it
 * builds both documents in its own process and answers the page's requests
 * for them, so there is no server to reach, no account to sign in as, and no
 * setting it could be missing — which is why it states none.
 */
export const HOME_BAR_SUITE: BrowserSuite = {
  label: "Home-bar clearance browser checks",
  config: "playwright.home-bar.config.ts",
  spec: "home-bar-clearance.spec.ts",
  required: [],
  covers: [
    "the call controls and the assistant's buttons keeping an emulated home bar's room below them",
    "both documents reserving none of it where the device reports no inset",
  ],
};

/**
 * The same sandbox document, measured where a reader meets it: inside the
 * app's own screen, in a signed-in browser, with the home bar's room handed
 * across the iframe boundary by the host rather than emulated by the run.
 *
 * `HOME_BAR_SUITE` above measures the document a server builds, at an inset
 * a phone would report. A browser never reports one to a page in an iframe,
 * whatever the phone underneath is doing, so the room the assistant's
 * buttons keep there comes from the host screen measuring the window and
 * handing the number in. That handover is what this run draws: nothing it
 * measures is emulated, and the one thing that differs between its two
 * readings is whether the browser is a phone's.
 *
 * It signs in, so it needs the app's URL and the provider keys, and the
 * address of a configured account to sign in as -- with a short-lived ticket
 * the provider issues for that account, which is why the password that goes
 * with the address is not among these. The API's URL is not either: the app
 * knows where its own server is, and this run only watches it answer.
 */
export const HOSTED_HOME_BAR_SUITE: BrowserSuite = {
  label: "Hosted sandbox home-bar browser check",
  config: "playwright.hosted-home-bar.config.ts",
  spec: "hosted-home-bar.spec.ts",
  required: ["E2E_CHAT_URL", ...CLERK_KEY_ENV_VARS, "E2E_MODERATOR_EMAIL"],
  covers: [
    "the assistant's buttons keeping the home bar's room below them in a phone browser",
    "the same page reserving none of that room in a browser that is not a phone's",
  ],
};

/** The release gate: one signed-in journey through the whole product. */
export const LAUNCH_SMOKE_SUITE: BrowserSuite = {
  label: "Launch smoke browser check",
  config: "playwright.launch-smoke.config.ts",
  spec: "launch-smoke.spec.ts",
  required: BROWSER_PREREQUISITE_ENV_VARS,
  covers: [
    "signing in through the Expo-served client and loading the profile",
    "creating a room, joining it live, and exchanging an encrypted message",
    "the assistant's reply in the sandbox room",
    "leaving a room and decrypting its stored message again after rejoining",
  ],
};

/**
 * The account fixture's own cleanup, proved by a case that really times out.
 * It creates disposable accounts without signing any of them in, so it needs
 * the provider keys and the database, and neither URL. Its spec reaches the
 * accounts fixture alone: the signed-in pages, and the read of `E2E_CHAT_URL`
 * they need, are a module of their own, so that setting is not one this run
 * goes without -- which is what the `unused` entry below states, and what
 * the check holds the next import of that other module to.
 */
export const MODERATION_TIMEOUT_SUITE: BrowserSuite = {
  label: "Moderation timeout cleanup regression",
  config: "playwright.moderation-timeout.config.ts",
  spec: "moderation-timeout.spec.ts",
  required: [
    ...CLERK_KEY_ENV_VARS,
    "DATABASE_URL",
    // The fixture asks the provider for nothing until the recovery sweep's
    // refusal check has both moderator addresses to exclude from deletion,
    // so a run without them creates no accounts at all. Their passwords are
    // another matter: this suite signs nobody in.
    "E2E_MODERATOR_EMAIL",
    "E2E_MODERATOR_EMAIL_2",
  ],
  optional: [
    ...RECOVERY_SWEEP_OPTIONAL,
    // Handed down by `moderation-timeout.verify.mjs`, the only thing that
    // starts this run, and the case refuses to run at all without it. It is
    // where that verifier watches the accounts appear, not something an
    // environment is set up to provide, so demanding it here would fail
    // every run that is not the verifier's own.
    {
      name: "MODERATION_TIMEOUT_RECORD",
      without: "the one case throws on its first line, verifying no cleanup",
    },
    // Handed down by the same verifier, and read by this suite's config
    // rather than by its cases: it is where the JSON reporter writes, which
    // is what the verifier reads to say why a run produced no accounts.
    // Unset, the config writes that report to a throwaway file under the
    // system temporary directory instead, so a run by hand loses the
    // verifier's diagnostic and nothing else — which is why this is stated
    // here rather than required.
    {
      name: "MODERATION_TIMEOUT_REPORT",
      without: "this run's report goes to a temporary file nobody reads back",
    },
  ],
  unused: [
    {
      name: "E2E_CHAT_URL",
      why: "no case here opens a page, so the app's URL is nothing this run goes without; the helpers that do open one, and the read of it they need, live in moderation.fixture.ts, which this spec does not import",
    },
  ],
  covers: [
    "both disposable accounts being removed when a moderation case times out",
  ],
};

/**
 * One command a person runs by hand, and the settings it cannot run without.
 *
 * A browser suite is reached through a Playwright config, so its settings are
 * checked in that config's `globalSetup`. These commands are reached by no
 * config and no spec: they are `node <module>` entry points into the same
 * disposable-account recovery helpers the moderation fixture uses, so nothing
 * held them to a list at all. A setting one of them needs and an environment
 * does not provide therefore surfaced as a throw partway through a command
 * whose work is deleting accounts -- after it had opened the database and
 * asked the provider for the moderator accounts it must not delete -- and the
 * command's own catch reported it as the recovery failing rather than as a
 * setting to set.
 *
 * So each one states its settings here, beside the suites', and refuses
 * before it reaches an account. `scripts/src/checkCommandRequirements.ts`
 * holds each list to what that command and the helpers it hands the whole
 * environment to actually read, in both directions, the way the same
 * comparison holds a suite's.
 */
export interface CommandRequirement {
  /** Named when the command refuses, so a notice says which command it is. */
  readonly label: string;
  /**
   * The module the command runs: a bare name for one in the `e2e` directory
   * of `artifacts/api-server`, or a workspace-relative path for one
   * elsewhere. Named the way a suite names its config, and read the same way
   * -- what the command is held to is what that module, and everything it
   * imports, takes out of the environment.
   */
  readonly command: string;
  /**
   * What the command cannot run without: a missing one stops it here, before
   * it creates, reads or deletes anything.
   *
   * As with a suite, this has to cover everything the module and the helpers
   * it hands the environment to read, and no more than that. Whether a
   * setting is present is all that is judged: one that is set to the wrong
   * thing -- a live provider key, a deployment -- is refused afterwards by
   * the command's own development check, which is where that rule is stated.
   */
  readonly required: readonly string[];
  /**
   * Settings it reads that a run may go without, stated so the gap is a
   * decision rather than an omission nobody noticed. Entries are the suites'
   * -- the same list, stating the same names and the same lines -- because a
   * command reads them by handing the environment to the same helpers.
   *
   * What a command does not do with them is print them. A suite names the
   * optional settings a run went without, which is where a command parts
   * company with it: the entries here are the recovery sweep's, and an unset
   * `NODE_ENV` and `REPLIT_DEPLOYMENT` are the condition that sweep insists
   * on rather than coverage this run is going without. Naming them would
   * report the ordinary development run as a gap on every run, and a notice
   * that is always there is one its readers learn to skip. Each entry's
   * `without` line is written for whoever reads this declaration, and
   * printed where the suites announce the same settings.
   */
  readonly optional?: readonly OptionalSetting[];
  /**
   * The browser run this command starts as a child of its own, handed this
   * environment whole.
   *
   * A command is otherwise held to the settings read in the files it runs,
   * and a run it starts is past the end of those: what that run takes out of
   * the environment is read in another process, in files this command never
   * imports, so a spread of the environment into it is reported rather than
   * passed over -- settings nobody can see are settings no list can be held
   * to.
   *
   * Naming the suite answers that. Its own settings are declared above and
   * held to the config and spec it loads, so what is handed down is known
   * after all, and this command is then held to require everything that run
   * cannot start without. Which is the point of saying so here: a setting
   * the suite comes to need is refused by this command, by name, before the
   * run is started -- rather than inside a child process whose output a
   * command deliberately never prints.
   */
  readonly starts?: BrowserSuite;
  /** What it goes on to do once it starts, one item per line. */
  readonly does: readonly string[];
}
export type BrowserTestOutcome = "run" | "skip" | "fail";

export interface BrowserTestDecision {
  readonly kind: BrowserTestOutcome;
  /** One line stating the outcome; also the message thrown when failing. */
  readonly headline: string;
  /** Why it came out this way and what to do next; "" when nothing to add. */
  readonly detail: string;
  /** Names of required settings this environment does not provide. */
  readonly missing: readonly string[];
  /**
   * Names of the suite's `optional` settings this environment does not
   * provide either. These stop nothing -- a run goes ahead without them --
   * but the cases read them, so the run says which ones it went without, and
   * says with each what its cases did instead.
   */
  readonly absentOptional: readonly string[];
}

type Environment = Readonly<Record<string, string | undefined>>;

function read(env: Environment, name: string): string {
  return (env[name] ?? "").trim();
}

function indent(lines: readonly string[]): string {
  return lines.map((line) => (line === "" ? "" : `  ${line}`)).join("\n");
}

/**
 * What this environment asked for, read the one way every decision here
 * reads it: the `BROWSER_TESTS` value trimmed and lower-cased, and whether it
 * is one this module accepts.
 *
 * Two decisions are made from it -- one suite's, as that suite starts, and a
 * whole chain's before the first of them starts -- and a chain reading the
 * waiver even slightly differently from the suites standing behind it would
 * either refuse a run they would have made or clear one they will refuse.
 */
function requestedOutcome(env: Environment): {
  readonly requested: string;
  readonly recognized: boolean;
} {
  const requested = read(env, BROWSER_TESTS_ENV_VAR).toLowerCase();
  return {
    requested,
    recognized: requested === "" || BROWSER_TESTS_VALUES.includes(requested),
  };
}
/**
 * Reads the environment and decides one browser suite's outcome. Pure, so the
 * rule itself is covered by a suite that needs no browser, no running app,
 * and no credentials of its own.
 */
export function decideBrowserTests(
  env: Environment,
  suite: BrowserSuite,
): BrowserTestDecision {
  const { requested, recognized } = requestedOutcome(env);
  const missing = suite.required.filter((name) => read(env, name) === "");
  const absent = (suite.optional ?? []).filter(
    (entry) => read(env, entry.name) === "",
  );
  const absentOptional = absent.map((entry) => entry.name);

  if (!recognized) {
    return {
      kind: "fail",
      missing,
      absentOptional,
      headline: `${suite.label}: ${BROWSER_TESTS_ENV_VAR} is set to something this does not recognize.`,
      detail: UNRECOGNIZED_DETAIL,
    };
  }

  if (requested === BROWSER_TESTS_SKIP) {
    const whatIsLeft =
      missing.length === 0
        ? suite.required.length === 0
          ? [
              "These checks need no settings at all, so this run could have made",
              `them anywhere. Unset ${BROWSER_TESTS_ENV_VAR} to run the suite.`,
            ]
          : [
              "Every setting these checks need is present here, but this run was",
              `asked not to use them. Unset ${BROWSER_TESTS_ENV_VAR} to run the suite.`,
            ]
        : [
            `Not provided in this environment either: ${missing.join(", ")}.`,
            `Running this suite needs both those and ${BROWSER_TESTS_ENV_VAR} unset.`,
            ...(missing.includes("DATABASE_URL")
              ? [
                  "",
                  "DATABASE_URL is one of them, so these spec files still fail to",
                  "load: they import @workspace/db, which refuses to load without",
                  "it. Set DATABASE_URL to let a waived run finish.",
                ]
              : []),
          ];

    return {
      kind: "skip",
      missing,
      absentOptional,
      headline: `${suite.label}: SKIPPED (${BROWSER_TESTS_ENV_VAR}=${BROWSER_TESTS_SKIP}).`,
      detail: indent([
        "Nothing in this run was verified in a browser, so this run leaves out:",
        "",
        ...suite.covers.map((item) => `  - ${item}`),
        "",
        ...whatIsLeft,
      ]),
    };
  }

  if (missing.length > 0) {
    return {
      kind: "fail",
      missing,
      absentOptional,
      headline: `${suite.label} cannot run: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.`,
      detail: indent([
        "That fails the run instead of skipping those cases. A case that skips",
        "itself reports the same green as one that passed, which is how the",
        "checks made before publishing could stop running without anyone",
        "noticing. These are the ones covering:",
        "",
        ...suite.covers.map((item) => `  - ${item}`),
        "",
        "Set the settings named above; artifacts/api-server/e2e/README.md says",
        "what each one is.",
        "Only their names are printed here, never their values.",
        "",
        `To leave these checks out on purpose, set ${BROWSER_TESTS_ENV_VAR}=${BROWSER_TESTS_SKIP}`,
        "instead -- that run leaves them out and says so.",
      ]),
    };
  }

  return {
    kind: "run",
    missing,
    absentOptional,
    headline:
      // A suite that needs nothing has nothing to name, and the sentence
      // that names what a run was given would trail off into a bare full
      // stop: the one shape of this notice a reader would skip.
      suite.required.length === 0
        ? `${suite.label}: running; these checks need no settings of their own.`
        : `${suite.label}: running against the configured ${suite.required.join(", ")}.`,
    detail:
      absent.length === 0
        ? ""
        : indent([
            "Going without, and declared optional for this suite, with what",
            "this run's cases did instead:",
            "",
            ...absent.map((entry) => `  - ${entry.name}: ${entry.without}`),
            "",
            "Nothing fails for it -- a setting is stated optional because a run",
            "may go without it -- but what each line above says is what this run",
            "did, and a run covering less than a fully configured one would",
            "otherwise print exactly what that one prints, which is the quiet",
            "pass this notice exists to prevent.",
            "",
            "e2e/README.md says what each one is. Only their names are printed",
            "here, never their values.",
          ]),
  };
}

/**
 * Whether this run was deliberately told to leave `suite` out, and the reason
 * its cases report when they skip. The cases read this rather than the
 * environment variable, so a skip can never disagree with the decision the
 * run already announced.
 */
export function browserTestWaiver(
  suite: BrowserSuite,
  env: Environment = process.env,
): { readonly waived: boolean; readonly reason: string } {
  return {
    waived: decideBrowserTests(env, suite).kind === "skip",
    reason: `${suite.label} were left out of this run (${BROWSER_TESTS_ENV_VAR}=${BROWSER_TESTS_SKIP}).`,
  };
}

/**
 * Playwright `globalSetup` body: reports the decision, and fails the run when
 * these checks are expected but cannot be driven. Throwing here stops the run
 * before any spec file loads, so the reason is what the run ends on rather
 * than being buried under an otherwise green summary.
 */
export function announceBrowserTests(
  suite: BrowserSuite,
  env: Environment = process.env,
): void {
  const decision = decideBrowserTests(env, suite);
  const message = decision.detail
    ? `\n${decision.headline}\n\n${decision.detail}\n`
    : `\n${decision.headline}\n`;

  if (decision.kind === "fail") {
    console.error(message);
    throw new Error(decision.headline);
  }

  console.log(message);
}

/**
 * A command that runs several browser suites one after another, so that the
 * settings all of them need can be decided before the first one starts.
 *
 * What it names is the suites themselves, never a list of settings: the
 * names come off each suite's own `required`, so a suite that starts needing
 * another setting is covered here the moment it declares one, and a second
 * list that could fall behind the first never exists.
 */
export interface BrowserSuiteChain {
  /** The command a person runs, named in what this decides. */
  readonly command: string;
  /** The suites it runs, in the order it runs them. */
  readonly suites: readonly BrowserSuite[];
}
/** Names of `command`'s required settings this environment does not provide. */
export function missingCommandSettings(
  command: CommandRequirement,
  env: Environment = process.env,
): readonly string[] {
  return command.required.filter((name) => read(env, name) === "");
}

/**
 * Whether `command` may start, and the reason printed when it may not: the
 * settings it cannot run without that this environment does not provide,
 * named in one notice before the command touches an account.
 *
 * This answers rather than throws. These commands catch everything they do,
 * so that a provider error cannot put an address or an account id into the
 * output; a throw here would be caught by that same handler and reported as
 * the recovery failing, which is the failure this exists to replace.
 *
 * Whether a setting is present is all this judges. One that is set to the
 * wrong thing -- a live provider key, a deployment -- is refused afterwards
 * by the command's own development check, which is the single place that
 * rule is stated and the one that must go on stopping a sweep of a real
 * account.
 */
export function requireCommandSettings(
  command: CommandRequirement,
  env: Environment = process.env,
): boolean {
  const missing = missingCommandSettings(command, env);
  if (missing.length === 0) return true;

  console.error(
    [
      "",
      `${command.label} cannot run: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.`,
      "",
      indent([
        "Nothing was created or deleted. This stops before the command opens the",
        "database or reaches the provider; once it starts, it goes on to:",
        "",
        ...command.does.map((item) => `  - ${item}`),
        "",
        "Set the settings named above; artifacts/api-server/e2e/README.md says",
        "what each one is.",
        "Only their names are printed here, never their values.",
      ]),
      "",
    ].join("\n"),
  );
  return false;
}

/**
 * The guarded sweep that removes the disposable accounts an interrupted
 * moderation run left behind. It signs nobody in, so it needs no moderator
 * passwords -- but it does need both moderator addresses, which are how it
 * refuses to delete an account that answers to one of them.
 */
export const MODERATION_RECOVERY_COMMAND: CommandRequirement = {
  label: "Moderation disposable-account recovery",
  command: "moderation-recover.mjs",
  required: [
    ...CLERK_KEY_ENV_VARS,
    "DATABASE_URL",
    "E2E_MODERATOR_EMAIL",
    "E2E_MODERATOR_EMAIL_2",
  ],
  optional: [...RECOVERY_SWEEP_OPTIONAL],
  does: [
    "deleting the disposable provider accounts an abandoned run left behind",
    "deleting the profile, moderator, and moderation history rows they own",
  ],
};

/**
 * The live check that the sweep above really recovers an interrupted create.
 * It creates a disposable account against the development provider, so it is
 * opted into deliberately: `MODERATION_RECOVERY_LIVE` is required here rather
 * than optional, because this command is the only thing that runs, and the
 * run it makes without it is no run at all.
 */
export const MODERATION_RECOVERY_LIVE_COMMAND: CommandRequirement = {
  label: "Live moderation recovery verification",
  command: "moderation-recovery.verify.mjs",
  required: [
    "MODERATION_RECOVERY_LIVE",
    ...CLERK_KEY_ENV_VARS,
    "DATABASE_URL",
    "E2E_MODERATOR_EMAIL",
    "E2E_MODERATOR_EMAIL_2",
  ],
  optional: [...RECOVERY_SWEEP_OPTIONAL],
  does: [
    "creating one disposable provider account and interrupting the create",
    "recovering it: deleting that account, and the profile row it owns",
    "comparing both moderator accounts against a snapshot taken beforehand",
  ],
};

/**
 * The check that a moderation case which runs out of time still has its
 * disposable accounts taken away afterwards. It starts the suite above as a
 * Playwright run of its own, one case that deliberately times out, and reads
 * what that run recorded to say whether the cleanup happened.
 *
 * So it needs everything that run needs, `starts` being what holds it to
 * that, and both moderators' passwords besides: the accounts it must find
 * untouched at the end are the ones those passwords belong to, and it proves
 * each one against the provider before it lets anything be created. Nothing
 * here signs in to the app -- no browser, no running app, and no address for
 * one.
 */
export const MODERATION_TIMEOUT_COMMAND: CommandRequirement = {
  label: "Moderation timeout cleanup verification",
  command: "moderation-timeout.verify.mjs",
  required: [
    ...CLERK_KEY_ENV_VARS,
    "DATABASE_URL",
    ...MODERATOR_CREDENTIAL_ENV_VARS,
  ],
  starts: MODERATION_TIMEOUT_SUITE,
  does: [
    "starting a Playwright run that creates two disposable provider accounts",
    "deleting any that run leaves behind, and the profile rows they own",
    "comparing both moderator accounts against a snapshot taken beforehand",
  ],
};

/**
 * Reads the environment and decides, for a whole chain of browser suites,
 * whether the command running them can start -- naming every setting they
 * declare that this environment does not provide, rather than the first
 * suite's worth of them.
 *
 * Each suite already decides this for itself as it starts, and goes on
 * doing so; what that cannot do is decide it early. A chain runs its suites
 * one after another, so a setting only its last suite signs in with stops
 * the command after every suite before it has run -- many minutes spent to
 * learn about a setting that was already missing when the first browser
 * started. This makes the same reading of the same declarations, once,
 * before any of them has run.
 *
 * `optional` settings are deliberately not reported here. A run may go
 * without one, so an absent one stops nothing, and each suite names its own
 * as it runs, beside the line saying what its cases did instead -- said
 * again up front, for every suite at once, it would be a list of things
 * nothing is wrong with, printed before the run that could say what they
 * cost. So `absentOptional` is empty here, and the suites' own
 * announcements remain where a reader is told what a run went without.
 */
export function decideReleaseSettings(
  env: Environment,
  chain: BrowserSuiteChain,
): BrowserTestDecision {
  const { requested, recognized } = requestedOutcome(env);

  // The union, in the order the command reaches the suites needing it, with
  // the suites that do: a name with nothing beside it says a setting is
  // missing without saying what the run loses by it.
  const needs = new Map<string, string[]>();
  for (const suite of chain.suites) {
    for (const name of suite.required) {
      const labels = needs.get(name);
      if (labels === undefined) needs.set(name, [suite.label]);
      else if (!labels.includes(suite.label)) labels.push(suite.label);
    }
  }
  const required = [...needs.keys()];
  const missing = required.filter((name) => read(env, name) === "");
  const absentOptional: readonly string[] = [];

  if (chain.suites.length === 0) {
    return {
      kind: "fail",
      missing,
      absentOptional,
      headline: `${chain.command} was given no browser suite to read settings from.`,
      detail: indent([
        "That fails rather than clearing the run. A chain with no suite in it",
        "has no setting to be missing, so this would pass exactly the way it",
        "passes for a fully configured environment -- and then hand the run on",
        "to suites whose settings nothing looked at.",
        "",
        "Either the command no longer runs browser suites, in which case",
        "nothing here needs deciding, or the suites it runs are no longer",
        "found -- which is what this is reporting.",
      ]),
    };
  }

  if (!recognized) {
    return {
      kind: "fail",
      missing,
      absentOptional,
      headline: `${chain.command}: ${BROWSER_TESTS_ENV_VAR} is set to something this does not recognize.`,
      detail: UNRECOGNIZED_DETAIL,
    };
  }

  if (requested === BROWSER_TESTS_SKIP) {
    return {
      kind: "skip",
      missing,
      absentOptional,
      headline: `${chain.command}: asking for none of their settings (${BROWSER_TESTS_ENV_VAR}=${BROWSER_TESTS_SKIP}).`,
      detail: indent([
        "The waiver is in force, so this stops nothing and wants nothing. The",
        "suites it stands in front of are:",
        "",
        ...chain.suites.map((suite) => `  - ${suite.label}`),
        "",
        "Each still decides for itself as the command reaches it, and prints",
        "what it is leaving out. What one of them does is not promised here: a",
        "suite whose run is started deliberately may ignore the waiver and run",
        "anyway, and says so where it says the rest.",
        "",
        `Unset ${BROWSER_TESTS_ENV_VAR} to run them all.`,
      ]),
    };
  }

  if (missing.length > 0) {
    return {
      kind: "fail",
      missing,
      absentOptional,
      headline: `${chain.command} cannot start: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.`,
      detail: indent([
        "Nothing has run yet. Every suite this command chains declares what it",
        "cannot run without, and this is every one of those settings that this",
        "environment does not provide -- named together, before the first",
        "browser starts, rather than one suite's worth at a time by a chain",
        "that stops partway through and leaves the rest to be found on the",
        "next run.",
        "",
        "Missing, and the suites that cannot run without each:",
        "",
        ...missing.map((name) => `  - ${name}: ${needs.get(name)!.join("; ")}`),
        "",
        "Set the settings named above; artifacts/api-server/e2e/README.md says",
        "what each one is.",
        "Only their names are printed here, never their values.",
        "",
        "Each suite still decides for itself as it starts. This names what",
        "those decisions would stop on, and nothing a suite does not ask for.",
        "",
        `To leave these checks out on purpose, set ${BROWSER_TESTS_ENV_VAR}=${BROWSER_TESTS_SKIP}`,
        "instead -- that run leaves them out and says so.",
      ]),
    };
  }

  return {
    kind: "run",
    missing,
    absentOptional,
    headline:
      required.length === 0
        ? `${chain.command}: starting; the browser suites it runs need no settings of their own.`
        : `${chain.command}: starting against the configured ${required.join(", ")}.`,
    detail: indent([
      "Read before the first suite starts, from what each of them declares:",
      "",
      ...chain.suites.map((suite) => `  - ${suite.label}`),
      "",
      "A setting the last of them signs in with is therefore one this run",
      "already has, so the first suite to start is the first thing that can",
      "fail.",
    ]),
  };
}

/**
 * Why an unrecognized `BROWSER_TESTS` stops a run, said the same way to
 * whoever set it, whether it stopped one suite or a whole chain of them.
 */
const UNRECOGNIZED_DETAIL = indent([
  `Accepted values are "${BROWSER_TESTS_REQUIRED}" (the default: this environment`,
  `drives these checks) and "${BROWSER_TESTS_SKIP}" (none are expected here).`,
  "",
  "An unrecognized value fails rather than being read as one of them: a",
  `typo silently taken for "${BROWSER_TESTS_SKIP}" is exactly the quiet pass this`,
  "check exists to prevent.",
  "",
  `The value it was given is not repeated here. ${BROWSER_TESTS_ENV_VAR} is a`,
  "setting, but nothing stops a credential being assigned to it by mistake,",
  "and a notice that echoed one into the run output would be a worse leak",
  "than the mistake it reports.",
]);
