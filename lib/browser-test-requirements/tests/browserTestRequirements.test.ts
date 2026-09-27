/**
 * The rules every browser suite announces, proved in the package that holds
 * them.
 *
 * This suite ran under `artifacts/api-server`'s vitest while the decision
 * lived there. The decision has since become a shared library — every
 * Playwright config in the workspace reaches it by package name — so the
 * suite follows it, and someone editing `src/index.ts` no longer has to know
 * that the test for it sits in another package's source tree.
 *
 * It runs from `pnpm run test` the way every other `tests/` directory in this
 * workspace does: the root discovery hands every suite under a package's
 * `tests` directory to `node --test`, which runs this file straight from
 * source, so the import below names the `.ts` file it loads. Nothing new
 * runs it — the rules are a pure function of the environment, so `node:test`
 * and `node:assert` cover them with no browser, no running app, and no
 * credentials of their own, and one package does not get a runner to itself.
 *
 * `tsconfig.tests.json` is what puts this file in a typechecking program:
 * the package's own project emits the library's declarations and is rooted at
 * `src`, so it cannot also hold the tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  announceBrowserTests,
  AUTH_LAYOUT_SUITE,
  BANNED_ROOM_SUITE,
  BROWSER_TESTS_ENV_VAR,
  BROWSER_PREREQUISITE_ENV_VARS,
  browserTestWaiver,
  decideBrowserTests,
  decideReleaseSettings,
  HOME_BAR_SUITE,
  LAUNCH_SMOKE_SUITE,
  MODERATION_SUITE,
  MODERATION_TIMEOUT_SUITE,
  MODERATOR_CREDENTIAL_ENV_VARS,
  type BrowserSuite,
} from "../src/index.ts";

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

function configured(overrides: Record<string, string | undefined> = {}) {
  return { ...CONFIGURED, ...overrides };
}

/**
 * What the disposable-account recovery sweep reads, which both moderation
 * suites state as optional. A real development run leaves the first two
 * unset -- that is how the sweep knows it is not looking at a deployment --
 * so a case naming the optional settings a run goes without provides these,
 * to stay about the one setting it is for.
 */
const SWEEP_PROVIDED: Record<string, string> = {
  NODE_ENV: "not-a-deployment",
  REPLIT_DEPLOYMENT: "0",
  ADMIN_USER_IDS: "user_exampleadmin",
};

/**
 * What a suite says a run does without one of its optional settings, as the
 * line the entry carries. Read from the declaration rather than written out
 * here, so these cases are about the line reaching the run's output and not
 * about the wording of any one of them.
 */
function whatIsLost(suite: BrowserSuite, name: string): string {
  const entry = (suite.optional ?? []).find(
    (candidate) => candidate.name === name,
  );
  if (!entry) throw new Error(`${suite.label} states nothing for ${name}`);
  return entry.without;
}

/** How the run prints one of them: the name, then what it cost this run. */
function absentLine(suite: BrowserSuite, name: string): string {
  return `- ${name}: ${whatIsLost(suite, name)}`;
}

/**
 * What the timeout suite's own verifier hands the run it starts, and nothing
 * else provides: where the disposable accounts are recorded, and where that
 * run's JSON report is written. Both are stated optional on the suite, so a
 * case about one of them provides the other, invented here as the rest are.
 */
const VERIFIER_PROVIDED: Record<string, string> = {
  MODERATION_TIMEOUT_RECORD: "/tmp/not-a-real-record.json",
  MODERATION_TIMEOUT_REPORT: "/tmp/not-a-real-report.json",
};

/** A notice has to say this much, or nobody can act on it. */
function assertSays(printed: string, phrase: string): void {
  assert.ok(
    printed.includes(phrase),
    `expected the notice to mention ${phrase}, got:\n${printed}`,
  );
}

/** A notice that says this much has said too much. */
function assertDoesNotSay(
  printed: string,
  phrase: string,
  what = "this",
): void {
  assert.ok(
    !printed.includes(phrase),
    `the notice printed ${what} when it should not have:\n${printed}`,
  );
}

describe("deciding whether a run may go without the browser settings", () => {
  it("runs the moderation suite when every setting is provided", () => {
    const decision = decideBrowserTests(configured(), MODERATION_SUITE);

    assert.equal(decision.kind, "run");
    assert.deepEqual(decision.missing, []);
    assertSays(decision.headline, MODERATION_SUITE.label);
  });

  it("fails, rather than skipping, when a moderator's credentials are absent", () => {
    const decision = decideBrowserTests(
      configured({ E2E_MODERATOR_PASSWORD_2: undefined }),
      MODERATION_SUITE,
    );

    assert.equal(decision.kind, "fail");
    assert.deepEqual(decision.missing, ["E2E_MODERATOR_PASSWORD_2"]);
    assertSays(decision.headline, "E2E_MODERATOR_PASSWORD_2");
    // The failure has to say what to do next, or the next person's only move
    // is to delete the check.
    assertSays(decision.detail, `${BROWSER_TESTS_ENV_VAR}=skip`);
  });

  it("names every missing setting at once, rather than one per run", () => {
    const decision = decideBrowserTests(
      configured({ E2E_CHAT_URL: undefined, CLERK_SECRET_KEY: undefined }),
      MODERATION_SUITE,
    );

    assert.deepEqual(decision.missing, ["E2E_CHAT_URL", "CLERK_SECRET_KEY"]);
    assertSays(decision.headline, "E2E_CHAT_URL, CLERK_SECRET_KEY");
  });

  it("treats a blank setting as absent", () => {
    const decision = decideBrowserTests(
      configured({ E2E_MODERATOR_EMAIL: "   " }),
      MODERATION_SUITE,
    );

    assert.equal(decision.kind, "fail");
    assert.deepEqual(decision.missing, ["E2E_MODERATOR_EMAIL"]);
  });

  it("never prints a credential value, only its variable name", () => {
    const decision = decideBrowserTests(
      configured({ E2E_MODERATOR_EMAIL_2: undefined }),
      MODERATION_SUITE,
    );

    const printed = `${decision.headline}\n${decision.detail}`;
    for (const [name, value] of Object.entries(CONFIGURED)) {
      assertDoesNotSay(printed, value, `the value of ${name}`);
    }
  });

  it("does not ask the banned-room suite for moderator credentials", () => {
    const withoutModerators = configured();
    for (const name of MODERATOR_CREDENTIAL_ENV_VARS) {
      delete withoutModerators[name];
    }

    assert.equal(
      decideBrowserTests(withoutModerators, BANNED_ROOM_SUITE).kind,
      "run",
    );
    // The same environment is not enough for the suite that signs in as them.
    assert.equal(
      decideBrowserTests(withoutModerators, MODERATION_SUITE).kind,
      "fail",
    );
  });

  it("asks both suites for the settings they share", () => {
    for (const name of BROWSER_PREREQUISITE_ENV_VARS) {
      const decision = decideBrowserTests(
        configured({ [name]: undefined }),
        BANNED_ROOM_SUITE,
      );
      assert.equal(decision.kind, "fail", `${name} should be required`);
    }
  });

  it("announces a suite that needs nothing without trailing off", () => {
    const decision = decideBrowserTests({}, HOME_BAR_SUITE);

    assert.equal(decision.kind, "run");
    assert.deepEqual(decision.missing, []);
    // What the other suites print names the settings the run was given.
    // This one has none to name, and that sentence would end at a bare full
    // stop: the one shape of this notice a reader learns to skip.
    assertDoesNotSay(
      decision.headline,
      "running against",
      "the sentence that names the settings a run was given",
    );
    assertSays(decision.headline, "need no settings of their own");
  });

  it("tells a waived run that the suite needed nothing from it", () => {
    const decision = decideBrowserTests(
      { [BROWSER_TESTS_ENV_VAR]: "skip" },
      HOME_BAR_SUITE,
    );

    assert.equal(decision.kind, "skip");
    assertSays(decision.detail, "home bar");
    // "Every setting these checks need is present here" would read as an
    // environment that happens to be complete enough. For a suite that asks
    // for nothing, no environment would have been missing anything, and the
    // waiver is the whole of why these checks were not made.
    assertSays(decision.detail, "need no settings at all");
    assertSays(decision.detail, `Unset ${BROWSER_TESTS_ENV_VAR}`);
  });

  it("skips where no browser checks are expected, and names what went unchecked", () => {
    const decision = decideBrowserTests(
      { [BROWSER_TESTS_ENV_VAR]: "skip" },
      MODERATION_SUITE,
    );

    assert.equal(decision.kind, "skip");
    assertSays(decision.headline, "SKIPPED");
    assertSays(decision.detail, "moderation history");
    // A waived run is still owed the list of what it would have to set to
    // stop being a waived run.
    assertSays(decision.detail, "E2E_CHAT_URL");
    assertSays(decision.detail, "E2E_MODERATOR_PASSWORD_2");
    // Waiving these checks does not make the spec files loadable without a
    // database, and the notice has to say so rather than leaving the reader
    // with an import failure to interpret.
    assertSays(decision.detail, "@workspace/db");
  });

  it("drops the database note from a waived run that does have one", () => {
    const decision = decideBrowserTests(
      {
        [BROWSER_TESTS_ENV_VAR]: "skip",
        DATABASE_URL: CONFIGURED.DATABASE_URL,
      },
      MODERATION_SUITE,
    );

    assert.equal(decision.kind, "skip");
    assertDoesNotSay(decision.detail, "@workspace/db", "the database note");
    assertSays(decision.detail, "E2E_CHAT_URL");
  });

  it("keeps the waiver in force when everything happens to be configured", () => {
    // These checks sign in as real administrator accounts and write history
    // rows, so "no browser checks are expected here" has to be able to mean
    // "do not touch the accounts you can see".
    const decision = decideBrowserTests(
      configured({ [BROWSER_TESTS_ENV_VAR]: "skip" }),
      MODERATION_SUITE,
    );

    assert.equal(decision.kind, "skip");
    assertSays(decision.detail, "asked not to use them");
  });

  it("accepts the waiver however it was capitalized or padded", () => {
    const decision = decideBrowserTests(
      { [BROWSER_TESTS_ENV_VAR]: "  SKIP \n" },
      BANNED_ROOM_SUITE,
    );

    assert.equal(decision.kind, "skip");
  });

  it("refuses a value it does not recognize instead of guessing", () => {
    const decision = decideBrowserTests(
      configured({ [BROWSER_TESTS_ENV_VAR]: "skipp" }),
      MODERATION_SUITE,
    );

    assert.equal(decision.kind, "fail");
    assertSays(decision.headline, BROWSER_TESTS_ENV_VAR);
    assertSays(decision.detail, '"required"');
    assertSays(decision.detail, '"skip"');
  });

  it("does not echo the unrecognized value back into the run output", () => {
    // Nothing stops a credential being assigned to this variable by mistake,
    // and a notice that repeated one would be a worse leak than the mistake.
    const secretShaped = "sk_test_9f3b1c7d2e4a6081not-a-real-key";
    const decision = decideBrowserTests(
      configured({ [BROWSER_TESTS_ENV_VAR]: secretShaped }),
      MODERATION_SUITE,
    );

    assert.equal(decision.kind, "fail");
    const printed = `${decision.headline}\n${decision.detail}`;
    assertDoesNotSay(printed, secretShaped, "the value it was given");
    assertDoesNotSay(printed, "sk_test", "the start of that value");
    assertDoesNotSay(printed, "9f3b1c7d", "part of that value");
    // It still has to say enough to be acted on.
    assertSays(printed, '"skip"');
  });

  it("still fails when the checks are declared required but cannot run", () => {
    const decision = decideBrowserTests(
      configured({
        [BROWSER_TESTS_ENV_VAR]: "required",
        E2E_API_URL: undefined,
      }),
      MODERATION_SUITE,
    );

    assert.equal(decision.kind, "fail");
  });

  it("ignores an empty setting and reads the environment instead", () => {
    assert.equal(
      decideBrowserTests(
        configured({ [BROWSER_TESTS_ENV_VAR]: "  " }),
        MODERATION_SUITE,
      ).kind,
      "run",
    );
  });
});

describe("saying which optional settings a run is going without", () => {
  it("names one the environment does not provide", () => {
    // Everything this suite cannot run without is configured here; the
    // record path its own verifier hands down is not.
    const decision = decideBrowserTests(
      configured({
        ...SWEEP_PROVIDED,
        MODERATION_TIMEOUT_REPORT: VERIFIER_PROVIDED.MODERATION_TIMEOUT_REPORT,
      }),
      MODERATION_TIMEOUT_SUITE,
    );

    assert.equal(decision.kind, "run");
    assert.deepEqual(decision.absentOptional, ["MODERATION_TIMEOUT_RECORD"]);
    assertSays(decision.detail, "MODERATION_TIMEOUT_RECORD");
  });

  it("says what the run did without it, beside the name", () => {
    // A name on its own reports that this run differs from a fully
    // configured one without saying how, which leaves the reader to open the
    // spec to find out whether it cost a case or nothing at all.
    const decision = decideBrowserTests(
      configured(SWEEP_PROVIDED),
      MODERATION_TIMEOUT_SUITE,
    );

    assertSays(
      decision.detail,
      absentLine(MODERATION_TIMEOUT_SUITE, "MODERATION_TIMEOUT_RECORD"),
    );
  });

  it("names all of them at once, rather than one per run", () => {
    const decision = decideBrowserTests(
      configured({ ...SWEEP_PROVIDED, ADMIN_USER_IDS: undefined }),
      MODERATION_TIMEOUT_SUITE,
    );

    assert.equal(decision.kind, "run");
    assert.deepEqual(decision.absentOptional, [
      "ADMIN_USER_IDS",
      "MODERATION_TIMEOUT_RECORD",
      "MODERATION_TIMEOUT_REPORT",
    ]);
    // Each on a line of its own, since what the run did without one says
    // nothing about what it did without the other.
    assertSays(
      decision.detail,
      absentLine(MODERATION_TIMEOUT_SUITE, "ADMIN_USER_IDS"),
    );
    assertSays(
      decision.detail,
      absentLine(MODERATION_TIMEOUT_SUITE, "MODERATION_TIMEOUT_RECORD"),
    );
    assertSays(
      decision.detail,
      absentLine(MODERATION_TIMEOUT_SUITE, "MODERATION_TIMEOUT_REPORT"),
    );
  });

  it("treats a blank optional setting as absent, as it does a required one", () => {
    const decision = decideBrowserTests(
      configured({
        ...SWEEP_PROVIDED,
        ...VERIFIER_PROVIDED,
        MODERATION_TIMEOUT_RECORD: "   ",
      }),
      MODERATION_TIMEOUT_SUITE,
    );

    assert.deepEqual(decision.absentOptional, ["MODERATION_TIMEOUT_RECORD"]);
  });

  it("says nothing extra when the run has its optional settings too", () => {
    const decision = decideBrowserTests(
      configured({ ...SWEEP_PROVIDED, ...VERIFIER_PROVIDED }),
      MODERATION_TIMEOUT_SUITE,
    );

    assert.equal(decision.kind, "run");
    assert.deepEqual(decision.absentOptional, []);
    assert.equal(decision.detail, "");
  });

  it("says nothing extra for a suite that declares nothing optional", () => {
    const decision = decideBrowserTests(configured(), BANNED_ROOM_SUITE);

    assert.equal(decision.kind, "run");
    assert.deepEqual(decision.absentOptional, []);
    assert.equal(decision.detail, "");
  });

  it("names the absent ones without printing the value of a present one", () => {
    const decision = decideBrowserTests(
      configured({
        ...SWEEP_PROVIDED,
        ...VERIFIER_PROVIDED,
        ADMIN_USER_IDS: undefined,
      }),
      MODERATION_TIMEOUT_SUITE,
    );

    const printed = `${decision.headline}\n${decision.detail}`;
    assertSays(printed, "ADMIN_USER_IDS");
    for (const [name, value] of Object.entries({
      ...CONFIGURED,
      ...VERIFIER_PROVIDED,
    })) {
      assertDoesNotSay(printed, value, `the value of ${name}`);
    }
  });

  it("leaves the failure and the waiver to report the gaps they are about", () => {
    // A run stopped for a missing required setting, or left out on purpose,
    // is not a run going without anything: nothing of it ran.
    const failed = decideBrowserTests(
      configured({
        ...SWEEP_PROVIDED,
        MODERATION_TIMEOUT_REPORT: VERIFIER_PROVIDED.MODERATION_TIMEOUT_REPORT,
        DATABASE_URL: undefined,
      }),
      MODERATION_TIMEOUT_SUITE,
    );
    assert.equal(failed.kind, "fail");
    assertDoesNotSay(
      failed.detail,
      "MODERATION_TIMEOUT_RECORD",
      "an optional setting",
    );
    // The names are still on the decision for anything that wants them.
    assert.deepEqual(failed.absentOptional, ["MODERATION_TIMEOUT_RECORD"]);

    const waived = decideBrowserTests(
      configured({ ...SWEEP_PROVIDED, [BROWSER_TESTS_ENV_VAR]: "skip" }),
      MODERATION_TIMEOUT_SUITE,
    );
    assert.equal(waived.kind, "skip");
    assertDoesNotSay(
      waived.detail,
      "MODERATION_TIMEOUT_RECORD",
      "an optional setting",
    );
  });
});

describe("telling the cases what the run decided", () => {
  it("waives them only when the run said so", () => {
    assert.equal(
      browserTestWaiver(MODERATION_SUITE, configured()).waived,
      false,
    );
    assert.equal(
      browserTestWaiver(MODERATION_SUITE, { [BROWSER_TESTS_ENV_VAR]: "skip" })
        .waived,
      true,
    );
  });

  it("leaves a misconfigured run's cases to run and fail, not to skip", () => {
    // Their run was already stopped before this file loaded; a case that
    // reached here anyway must not report the green a skip reports.
    assert.equal(
      browserTestWaiver(
        MODERATION_SUITE,
        configured({ E2E_CHAT_URL: undefined }),
      ).waived,
      false,
    );
  });

  it("names the waiver in the reason a skipped case reports", () => {
    const { reason } = browserTestWaiver(BANNED_ROOM_SUITE, {
      [BROWSER_TESTS_ENV_VAR]: "skip",
    });

    assertSays(reason, BANNED_ROOM_SUITE.label);
    assertSays(reason, `${BROWSER_TESTS_ENV_VAR}=skip`);
  });
});

describe("reporting the decision to the run", () => {
  it("stops the run and prints why when a setting is missing", (t) => {
    // Each test's own mocks are restored when it ends, so a replaced console
    // cannot outlive the case that replaced it.
    const error = t.mock.method(console, "error", () => {});

    assert.throws(
      () =>
        announceBrowserTests(
          MODERATION_SUITE,
          configured({ E2E_MODERATOR_EMAIL: undefined }),
        ),
      /E2E_MODERATOR_EMAIL/,
    );
    // The explanation belongs in the run's own output, not in a report file.
    assert.equal(error.mock.callCount(), 1);
    assertSays(
      String(error.mock.calls[0]?.arguments[0]),
      `${BROWSER_TESTS_ENV_VAR}=skip`,
    );
  });

  it("lets a waived run continue but announces the gap", (t) => {
    const log = t.mock.method(console, "log", () => {});

    assert.doesNotThrow(() =>
      announceBrowserTests(BANNED_ROOM_SUITE, {
        [BROWSER_TESTS_ENV_VAR]: "skip",
      }),
    );
    assert.equal(log.mock.callCount(), 1);
    assertSays(String(log.mock.calls[0]?.arguments[0]), "SKIPPED");
  });

  it("says the browser checks are running when they are", (t) => {
    const log = t.mock.method(console, "log", () => {});

    assert.doesNotThrow(() =>
      announceBrowserTests(MODERATION_SUITE, configured()),
    );
    assertSays(String(log.mock.calls[0]?.arguments[0]), "running against");
  });

  it("names an absent optional setting in the run's own output", (t) => {
    const log = t.mock.method(console, "log", () => {});

    assert.doesNotThrow(() =>
      announceBrowserTests(
        MODERATION_TIMEOUT_SUITE,
        configured({
          ...SWEEP_PROVIDED,
          MODERATION_TIMEOUT_REPORT:
            VERIFIER_PROVIDED.MODERATION_TIMEOUT_REPORT,
        }),
      ),
    );
    const printed = String(log.mock.calls[0]?.arguments[0]);
    assertSays(printed, "running against");
    assertSays(printed, "MODERATION_TIMEOUT_RECORD");
    // Beside the name, where the run is read: that is the whole difference
    // between a reader learning what went unverified and going to look.
    assertSays(
      printed,
      absentLine(MODERATION_TIMEOUT_SUITE, "MODERATION_TIMEOUT_RECORD"),
    );
  });

  it("prints only the headline for a run that goes without nothing", (t) => {
    const log = t.mock.method(console, "log", () => {});

    announceBrowserTests(
      MODERATION_TIMEOUT_SUITE,
      configured({ ...SWEEP_PROVIDED, ...VERIFIER_PROVIDED }),
    );

    const printed = String(log.mock.calls[0]?.arguments[0]);
    assertSays(printed, "running against");
    assertDoesNotSay(
      printed,
      "MODERATION_TIMEOUT_RECORD",
      "an optional setting this run has",
    );
  });
});

/**
 * The same reading, made for a whole chain of suites before the first of
 * them starts. A command running them one after another otherwise learns
 * about the last suite's settings last, having spent the runs in front of it
 * to get there.
 */
describe("deciding a chain of suites' settings before any of them starts", () => {
  /** A command running several suites, named the way a reader runs it. */
  const COMMAND = "pnpm run release:validate";

  /** Suites chained in the order a command would reach them. */
  const CHAIN: readonly BrowserSuite[] = [
    LAUNCH_SMOKE_SUITE,
    AUTH_LAYOUT_SUITE,
    HOME_BAR_SUITE,
    BANNED_ROOM_SUITE,
    MODERATION_SUITE,
  ];

  const chainOf = (suites: readonly BrowserSuite[] = CHAIN) => ({
    command: COMMAND,
    suites,
  });

  it("asks for what the suites declare, and for nothing besides", () => {
    // Nothing provided, so what comes back is the union itself: the names
    // are the suites' own, in the order the command reaches the suites
    // needing them, and a second list nobody keeps up to date is what this
    // would have to be to differ.
    const decision = decideReleaseSettings({}, chainOf());

    assert.deepEqual(
      [...decision.missing],
      [...new Set(CHAIN.flatMap((suite) => suite.required))],
    );
  });

  it("names a setting the last suite signs in with before the first runs", () => {
    const decision = decideReleaseSettings(
      configured({ E2E_MODERATOR_PASSWORD_2: undefined }),
      chainOf(),
    );

    assert.equal(decision.kind, "fail");
    assert.deepEqual(decision.missing, ["E2E_MODERATOR_PASSWORD_2"]);
    assertSays(decision.headline, "E2E_MODERATOR_PASSWORD_2");
  });

  it("names every missing setting at once, with the suites needing each", () => {
    const decision = decideReleaseSettings(
      configured({ E2E_API_URL: undefined, E2E_MODERATOR_EMAIL: undefined }),
      chainOf(),
    );

    assert.deepEqual(decision.missing, ["E2E_API_URL", "E2E_MODERATOR_EMAIL"]);
    assertSays(decision.headline, "E2E_API_URL, E2E_MODERATOR_EMAIL");
    // Which suites stop for it is what says what the run would lose, and
    // the auth-layout suite, which needs neither, is not one of them.
    assertSays(
      decision.detail,
      `- E2E_MODERATOR_EMAIL: ${MODERATION_SUITE.label}`,
    );
    assertSays(decision.detail, LAUNCH_SMOKE_SUITE.label);
    assertDoesNotSay(
      decision.detail.split("Missing, and the suites")[1] ?? "",
      AUTH_LAYOUT_SUITE.label,
      "a suite that needs neither setting",
    );
  });

  it("lets the command start when every declared setting is there", () => {
    const decision = decideReleaseSettings(configured(), chainOf());

    assert.equal(decision.kind, "run");
    assert.deepEqual(decision.missing, []);
    assertSays(decision.detail, MODERATION_SUITE.label);
  });

  it("asks a chain of suites that need nothing for nothing", () => {
    const decision = decideReleaseSettings({}, chainOf([HOME_BAR_SUITE]));

    assert.equal(decision.kind, "run");
    assert.deepEqual(decision.missing, []);
    // The sentence naming what a run was given would trail off into a bare
    // full stop, which is the one shape of this notice a reader would skip.
    assertSays(decision.headline, "need no settings of their own");
  });

  it("leaves the optional settings to the suites that go without them", () => {
    const decision = decideReleaseSettings(
      configured(),
      chainOf([MODERATION_SUITE, MODERATION_TIMEOUT_SUITE]),
    );

    assert.equal(decision.kind, "run");
    // Said again up front, for every suite at once, an absent optional
    // setting is a list of things nothing is wrong with -- printed before
    // the run that could say what going without them cost.
    assert.deepEqual(decision.absentOptional, []);
    assertDoesNotSay(
      decision.detail,
      "MODERATION_TIMEOUT_RECORD",
      "an optional setting the suite itself reports",
    );
  });

  it("asks for nothing where the waiver is in force", () => {
    const decision = decideReleaseSettings(
      { [BROWSER_TESTS_ENV_VAR]: "skip" },
      chainOf(),
    );

    assert.equal(decision.kind, "skip");
    assertSays(decision.headline, `${BROWSER_TESTS_ENV_VAR}=skip`);
    // Every suite it stands in front of, so the reader sees the same list
    // the suites are about to decide on one at a time.
    for (const suite of CHAIN) assertSays(decision.detail, suite.label);
    // What it must not do is promise those decisions. One suite's own
    // verifier starts its run deliberately and has it ignore the waiver, so
    // a chain announcing that all of them are left out would be describing
    // a run that does not happen.
    assertDoesNotSay(
      `${decision.headline}\n${decision.detail}`,
      "every browser suite it runs is left out",
      "a promise about what each suite will decide",
    );
  });

  it("refuses a waiver value it does not recognize, without echoing it", () => {
    const decision = decideReleaseSettings(
      configured({ [BROWSER_TESTS_ENV_VAR]: "sk_test_pasted_by_mistake" }),
      chainOf(),
    );

    assert.equal(decision.kind, "fail");
    assertSays(decision.headline, COMMAND);
    assertDoesNotSay(
      `${decision.headline}\n${decision.detail}`,
      "sk_test_pasted_by_mistake",
      "the value it was given",
    );
  });

  it("fails a chain holding no suite rather than clearing the run", () => {
    const decision = decideReleaseSettings(configured(), chainOf([]));

    // With nothing to read, this would pass exactly the way it passes for a
    // configured environment, and then hand the run on to suites whose
    // settings nothing looked at.
    assert.equal(decision.kind, "fail");
    assertSays(decision.headline, "no browser suite");
  });

  it("prints the names of the settings it wants and no value of any", () => {
    const decision = decideReleaseSettings(
      configured({ E2E_MODERATOR_PASSWORD: undefined }),
      chainOf(),
    );
    const printed = `${decision.headline}\n${decision.detail}`;

    assertSays(printed, "E2E_MODERATOR_PASSWORD");
    for (const value of Object.values(CONFIGURED)) {
      assertDoesNotSay(printed, value, "a setting's value");
    }
  });
});
