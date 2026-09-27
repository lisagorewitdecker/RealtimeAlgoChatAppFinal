# Banned-room browser verification

This Playwright scenario uses two disposable Clerk synthetic users whose email
addresses contain `+clerk_test`. It verifies each account with Clerk's
development code `424242`, creates a unique room, bans the second user, and
checks the persistent banned-room explanation before and after returning
through the room list.

## Prerequisites

- The API Server and Chat App Expo workflows are running.
- `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are available as Replit
  Secrets for a Clerk development instance.
- `DATABASE_URL` points at the database the API uses, so the scenario can read
  its results and delete its disposable rows.
- `E2E_CHAT_URL` and `E2E_API_URL` are set on the command, as below.
- Native Chromium runtime libraries are installed.

A run missing any of these settings fails before the first spec file is
loaded, naming the ones to set; see [Settings these browser runs cannot go
without](#settings-these-browser-runs-cannot-go-without).

## Run

From the workspace root:

```sh
E2E_CHAT_URL="https://${REPLIT_EXPO_DEV_DOMAIN}" \
E2E_API_URL="https://${REPLIT_DEV_DOMAIN}" \
pnpm --filter @workspace/api-server run test:e2e:banned-room
```

The test script installs the Chromium revision pinned by `@playwright/test`
before launching the browser, so a fresh workspace does not depend on a
developer's existing Playwright cache.

The test closes both browser contexts and deletes its unique room, database
profiles, and Clerk users in `finally`. Cleanup failures are reported together
with the original test failure.

## Settings these browser runs cannot go without

These suites used to skip themselves whenever a URL, a Clerk development key,
or a moderator's credentials was absent. A skipped browser check reports the
same green as a passing one, so the run made before publishing could have
verified none of banning, granting moderator access, or the moderation history
without anyone being told.

Every suite here now decides this once per run, in
`@workspace/browser-test-requirements` (`lib/browser-test-requirements`),
loaded as its Playwright config's `globalSetup` through a small
`<suite>.requirement.ts` module beside the config. The decision lives in a
shared library rather than in this package, because the convention is the
whole workspace's: a browser suite added in another artifact declares itself
there and imports it by package name, the way every other shared library is
reached. The decision is therefore made before any spec file loads, and it is
printed in the run's own output rather than only in a report file:

| `BROWSER_TESTS`      | Outcome                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| unset, or `required` | Every required setting present: the suite runs, naming any `optional` one absent. Any required one missing: the whole run fails, naming them. |
| `skip`               | The suite is left out, and the run prints what went unverified.                                                                               |
| anything else        | The run fails rather than reading a typo as `skip`.                                                                                           |

The waiver holds even where everything is configured, because these suites
sign in as real administrator accounts and write moderation history: "no
browser checks are expected here" has to be able to mean "do not touch them".
A waived run therefore reaches nothing outside itself: the config drops the
`setup` project that asks Clerk for a testing token along with the suite it
serves, and each spec declares its skip at file scope, as its cases are
collected, rather than inside a test body where a browser has already been
launched. It does not make the spec files loadable without `DATABASE_URL`,
though — they import `@workspace/db`, which throws at import without it — so
the skip notice says that too rather than leaving the reader to read it off an
import failure.

Only variable names are ever printed, never their values — including the value
`BROWSER_TESTS` itself was given, since nothing stops a credential being
assigned to it by mistake.

The wiring is checked rather than remembered. A config can decide nothing at
all, or decide at its own module scope, and the quiet pass comes back with no
signal — on the run made before publishing, which is the worst place to
discover it. `scripts/src/checkBrowserTestRequirements.ts` therefore fails a
Playwright config anywhere in this workspace — this directory, another
artifact, or above them all — that names no `globalSetup`, names a module that
is not on disk, or names one that never calls
`announceBrowserTests()` from `@workspace/browser-test-requirements`. It runs
from the workspace root as part of `pnpm run test`, and on its own as
`pnpm run check:browser-requirements`. Config module scope is deliberately not
accepted: Playwright evaluates that module again in every worker process, so a
decision made there is printed once per worker and fails as a worker crash
instead of as the run's reason for stopping.

It has to be that config's own suite, too. These configs are copied from one
another, so a new one left pointing at the original's `<suite>.requirement.ts`
is the natural mistake and the least visible one: this config wired to
`auth-layout.requirement.ts` would demand only `E2E_CHAT_URL`, then fail deep
inside a case for a missing Clerk key or database URL, reading as a broken
product rather than a missing setting. Matching file names do not settle which
suite a config belongs to — `playwright.config.ts` runs `banned-room.spec.ts` —
so each `BrowserSuite` names its own `config` and the `spec` that config runs.
The `config` is a bare name for one in this directory and a workspace-relative
path for one outside it; a bare name is only ever looked for here, so a suite
declared from another package writing one is told that, and told which config
in the tree is named that, rather than being sent after a file missing from a
package its author never touched. The `spec` is read beside the config that
runs it — this directory for the suites here, the declaring package's own
directory for a suite elsewhere — which is where Playwright collects it from,
`testDir` defaulting to the config's own directory. So a suite in another
package names its config once and keeps its spec short. That is where a person
reads which config runs
which spec for which suite, and the same check holds both sides to it: a config
no suite claims fails, a config whose `globalSetup` module announces a
different suite than the one declared for the spec it runs fails, and so does a
declaration naming a config or spec that is not there, or a spec its config's
`testMatch` does not collect.

Collecting its own spec is not the same as collecting only its own, so that is
checked too. A `testMatch` broad enough to reach another suite's spec — or left
out, taking Playwright's default of every spec file in `testDir` — would run
those cases on this suite's settings, which are not the ones declared for them,
and the missing setting would again surface inside a case.

Being wired to its own suite settles which list of settings a run is held to,
not whether that list is the right one, so the same check reads the other side
of it: the spec each config runs, the fixtures that spec imports, and the
workspace packages those import in turn are read for what they take out of
`process.env`, and every name found has to appear in that suite's `required`. A
case reading `E2E_API_URL` under a suite asking only for `E2E_CHAT_URL` is
correctly wired and still starts a run that fails inside the case, for a
setting nothing said was missing. Following the imports into this workspace's
own packages is what makes `DATABASE_URL` attributable: no spec names it, and
`@workspace/db` reads it at module scope for every suite importing it.

The config file is read the same way, and what it reads counts as its suite's:
every one of these takes its `baseURL` out of the environment, and a reporter's
output file can come from there too. Undeclared there it is the worse of the
two. Playwright evaluates the config module in the run's own process and again
in every worker, so a missing setting is never the run's stated reason for
stopping — it arrives as whatever the config makes of an absent value, once per
worker.

So is the `<suite>.requirement.ts` the config names as its `globalSetup`.
Nothing reaches it by following imports — the config names it as a string path,
which is how Playwright loads it — so what it reads was for a long time the one
thing here nobody held to a list, in the module written to stop a run naming
what is missing. Its reads count as that config's suite's now, reported against
the suite the config declares. That is why `launch-smoke.requirement.ts` hands
each URL's value in beside its name rather than looping over the two names and
reading `process.env[name]`: a setting reached through a name built at run time
has no name to check until the run is already going.

A suite may genuinely go without something its files read, and that is stated
rather than silently accepted: `optional` on the `BrowserSuite` names those,
each entry stating the setting's `name` beside one line saying what its cases
do without it. The timeout suite's `MODERATION_TIMEOUT_RECORD` is the reason
it exists — that path is handed down by the suite's own verifier rather than
provided by an environment, as is the `MODERATION_TIMEOUT_REPORT` its config
writes the JSON report to, which falls back to a throwaway file under the
system temporary directory — and the disposable-account recovery sweep's
`NODE_ENV`, `REPLIT_DEPLOYMENT`, and `ADMIN_USER_IDS` are stated the same way
wherever that sweep runs: the first two are how it refuses to touch a
deployment, so an ordinary development run leaves both unset, and the third is
an exclusion list only some deployments configure. A run may go without one,
but not quietly: the announcement names the `optional` settings this
environment does not provide and prints each one's line beside its name, since
those cases read them and a run covering less than a fully configured one would
otherwise print exactly what that one prints. The line is what makes the name
worth printing — going without `MODERATION_TIMEOUT_RECORD` reports a gap
without saying whether it cost a case or nothing at all, which is what `covers`
says for a waived run.

The comparison runs both ways, because a declaration nothing reads costs the
same wasted trip as a missing setting. A `required` entry nothing the suite
runs reads any more fails: it stops the run before any case loads and sends
someone off to configure a setting this suite does not use. An `optional` entry
nothing reads fails as a waiver held open. So both lists stay what the cases
actually do.

`optional` is still the wrong home for a setting the run never wants, even
where the check is satisfied by one of the suite's own files reading it. An
entry absent from every environment announces a gap on every run, and a notice
that cries wolf is one its readers learn to skip — the quiet pass the whole
mechanism exists to prevent. Since the check follows every module a spec
imports whatever the scope of the read, the answer is to move the code rather
than the read: the moderation suite's signed-in pages live in
`moderation.fixture.ts` and the disposable accounts they sign in to in
`moderation-accounts.fixture.ts`, so the timeout regression imports the
accounts alone and the app's URL is none of its business.

A split like that is nothing once it is made, though, and the next import of
the whole fixture puts the read back as one undeclared setting — which
`optional` answers in a line. So the suite says outright what it is meant never
to reach, in `unused`: the setting's name beside the reason, which is where the
code needing it lives instead. A name stated there may appear in neither
`required` nor `optional`, and nothing the spec or the config imports may read
it; the check fails on either, naming the module that reintroduced the read
rather than the list that would hide it. The timeout suite states `E2E_CHAT_URL`
that way, so pointing its spec back at `moderation.fixture.ts` fails here
instead of quietly widening what the run announces. Deleting the entry still
ends the rule — deliberately, beside the reason it was written, rather than by
a setting added to a list nobody rereads.

A file reaches a setting without naming it, too, and that is read as well.
Handing the whole environment to a helper — `assertDevelopment(process.env)`,
or the `env: process.env` the recovery sweep is given inside its options — is
followed into the function named, and on through that function's own handoffs
of the same environment, with everything read that way counted as this suite's.
A handoff that cannot be followed to a declaration the check can read is
reported rather than passed over, since a helper whose reads nobody can see
puts those settings back out of reach of the list. A function's own parameter
default (`env = process.env`) is not a handoff: nobody hands it anything, and
whether that default is ever taken is a question about its callers.

One handoff is passed over, and it is the announcement itself. A requirement
module hands `announceBrowserTests` the environment with this run's own answer
set in it — `{ ...process.env, BROWSER_TESTS: "required" }` — and what that
call reads off it is the suite's declaration, the same `required` and
`optional` names being compared here. Followed, it arrives at the shared
module's own `env[name]` reader and would be reported as a setting named while
the run is in progress, which describes that reader and nothing any of these
suites takes. Only that argument of that call: the environment reaching
anywhere else is read like any other handoff.

Adding a suite is therefore: declare what it needs as a `BrowserSuite` in that
shared module, naming the config that runs it, the spec that config runs, and
every setting those cases read — in `required`, or in `optional` with the line
saying what going without it costs that run; add a `<suite>.requirement.ts`
beside its config whose default export announces that suite; and name that
module as the config's `globalSetup`. Anything the config or that module reads
for itself belongs in the same lists, and is held to them the same way.


## Running every suite before publishing

```sh
pnpm run release:validate
```

One command runs every browser suite in this README, in a single `&&` chain, so
the first suite that fails fails the command: the offline moderation-recovery
regressions, then the launch smoke, the auth-layout check, the home-bar
clearance check, the banned-room
scenario, the moderation scenario, and the moderation-timeout regression —
cheapest first, so a broken build stops before the long runs. Each suite keeps
its own script for running it alone, given in the section below that describes
it, and the release command needs the union of the settings those sections
list.

That union is read before the first suite starts. `pnpm run release:settings`
is the chain's first command: it follows `release:validate` through the scripts
it calls, takes each suite's `BrowserSuite` declaration for the config that
script starts, and fails — naming every missing setting at once, with the
suites that cannot run without each — when this environment provides one of
them short. Without it a setting only the moderation suite signs in with
stopped the command after the recovery regressions, the launch smoke, the
auth-layout check and the banned-room scenario had already run, and named that
one setting, so the next run stopped on the next one. The names come off the
suites' own declarations rather than a second list beside them, and the
optional settings are left to the suites: each still announces what it went
without as the run reaches it. Running one suite alone is unchanged — its own
`globalSetup` reports what that suite needs, and nothing else.

The opt-in live Clerk recovery verification
(`test:e2e:moderation-recovery-live`) is the one suite deliberately left out: it
kills a worker mid-create against a live Clerk instance and refuses to start
without `MODERATION_RECOVERY_LIVE=1`, so a release run calling it would fail on
an opt-in publishing is not meant to give. That exclusion is declared with its
reason in `LEFT_OUT_SUITES` in `scripts/src/checkReleaseSuites.ts`, and
`pnpm run check:release-suites` fails when a browser suite is in neither the
chain nor that list — a suite waiting to be remembered by name is a check
nobody runs.

A whole chain takes about two and a half minutes against workflows already
running: 145 and 143 seconds on 2026-09-27, spent as roughly a second on the
offline recovery regressions, seventeen on the launch smoke, twelve on the
auth-layout check, one on the home-bar check, nineteen on the banned-room
scenario, seventy-seven on the moderation scenario, and eight on the
moderation-timeout regression, most of whose time is one real Playwright
timeout being waited out. The first chain after the Expo workflow restarts pays
for the client bundle too — about ten megabytes Metro has not built yet, some
seven seconds — and the launch smoke is what waits for it, so load the app once
before starting rather than reading that stage as mysteriously slow.

Between chains, leave the Clerk development instance alone for about ten
minutes. Every suite here signs accounts in against the same shared development
instance, and one chain's sign-ins, creations and deletions come near enough to
its limit that the next chain started too soon is throttled rather than
refused: one begun three minutes after the previous chain ended failed at the
moderation-timeout regression with `moderator preservation verification
failed`, where one begun after ten idle minutes passed with no
`too_many_requests` anywhere in the API server log. That stage compares each
configured moderator's Clerk record and profile row from its start against the
same two at its end, and watching both accounts across a whole run showed no
write to either landing in that window — so read that message as a throttled
read, not as the cleanup having reached a moderator.

Nothing else may be calling that instance while a chain runs, for the same
reason: one extra process reading those two moderator accounts every three
seconds was enough to fail two of the moderation scenario's nine cases. A chain
that passes can still leave a `too_many_requests` entry or two in the API
server log, surfacing there as a 500 on `PUT /api/profile` and in the app as a
failed public-key sync; neither fails the run, but both say it was already at
the limit, and the moderation section below describes what throttling looks
like from inside a case. After both passing chains the database held the two
configured moderators' profile rows and nothing else — no moderator rows, no
history rows, no room created during the run — and the recovery journal was
empty.

## Core launch release check

Run this gate against the running Expo Chat App and API Server workflows before
publishing. It uses the Expo-served client, routed profile and sandbox API
requests, and the `/api/socket.io` connection. The scenario signs in a
disposable Clerk user, loads the profile, creates a room, exchanges an
encrypted message, gets a real assistant response, leaves, and rejoins to
decrypt the stored message again. This browser check exercises the Expo web
client; it does not verify whether an installed iOS or Android Expo Go client
supports the project's SDK.

```sh
E2E_CHAT_URL="https://${REPLIT_EXPO_DEV_DOMAIN}" \
E2E_API_URL="https://${REPLIT_DEV_DOMAIN}" \
pnpm --filter @workspace/api-server run test:e2e:launch-smoke
```

Required environment variable names:

- `E2E_CHAT_URL` — routed URL for the running Expo Chat App.
- `E2E_API_URL` — routed API origin used by the Expo client.
- `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` — keys for the same Clerk
  development instance used by the app. Keep the secret key in Replit Secrets.
- `DATABASE_URL` — connection to the database used by the API, so the test can
  verify encrypted storage and remove its disposable data. Keep it in Replit
  Secrets.

This suite fails if any required variable is missing, or if either URL
is not a plain HTTP(S) origin — both decided in `launch-smoke.requirement.ts`
before the browser starts. For published
verification, set the two URL variables to the release candidate's routed
endpoints and provide the same Clerk keys and database connection through the
validation environment. It reports only missing variable names and the stage
that failed; screenshots and traces are disabled to avoid collecting credentials
or private message content.

The smoke check closes its temporary room through the authenticated realtime
protocol, deletes the room and profile rows (including encrypted messages and
key envelopes), closes the isolated browser context to discard local device
keys, and deletes the synthetic Clerk account in a post-test cleanup hook. The
hook still runs when the main test times out.

## Home-bar clearance in the served documents

```sh
pnpm --filter @workspace/api-server run test:e2e:home-bar
```

No settings, and nothing outside the run to reach: it builds the call and
sandbox documents in its own process, answers the page's requests for them and
for the socket client itself, and measures what it drew. There is no server to
start, no room to create and no account to sign in as.

What it measures is the room a phone's home indicator needs below the last
control of each document. Chromium is told what a device reports for
`env(safe-area-inset-bottom)`, and each surface is measured twice in the same
phone-sized window: with a home bar under it, where a control ending inside
that room fails, and with none reported, where a document keeping the same
room anyway is reserving a fixed number rather than the device's inset — dead
space in the browser build.

Turned sideways the same phone reports nothing under the page and a bar at
either edge instead — the notch or camera cutout at whichever edge it landed
on, the home indicator at the other — so both documents are measured again in
two landscape windows, one either side of the sandbox's 760px layout break,
where its assistant moves from a column down the right edge to a panel across
the foot. Each edge is read the same two ways, and what is compared against it
is the control nearest that edge: a call document that reserved only the
bottom fails with `there is 16px between the window's left edge and the
participant's name tag, inside the 59px the camera cutout covers`. Surfaces
meant to run under a bar are left out of that group on purpose — the call's
video is full-bleed, and only the controls drawn over it have to stay clear.

Each of those surfaces is then asked a second question, in its own case per
document, that no measurement can answer: what the browser finds at the
control's centre. A fixed element drawn over a control — the assistant's panel
on a phone, a banner, a toast — covers it without moving it, so every
clearance above still reads the same while the button underneath cannot be
tapped. The case fails when the topmost thing at a centre is neither that
control nor something it draws, and it names the control, which of them it was
and what was found in its place — a tip box fixed over the end-call button
reads as `the mute, camera and end-call buttons have p.tip-text inside div#tip
drawn over number 3 of the 3: the browser finds it at that control's centre, so
a tap there never reaches the control`.

`src/routes/rooms.bottomClearance.test.ts` answers the clearance question from
the stylesheet alone, in milliseconds and without a browser: it reads the
padding and the `viewport-fit=cover` both documents declare. What it cannot see
is a later rule, a panel laid over the controls, or a parent that clips taking
that room back while the declaration still reads correctly, which is what this
suite renders the documents to catch.

## Moderation browser verification

The moderation scenario signs in with each configured administrator account,
creates disposable target and non-moderator accounts for that run, and verifies
the moderation controls, account search, ban, restore, and server-side denial
path. An administrator's session is established once and reused by every case
that needs it; each case still opens its own browser context on top of it and
closes that context when it ends.
The corresponding Clerk user IDs must also be listed in the API server's
`ADMIN_USER_IDS` configuration; email addresses do not grant administrator access.

Both administrator credential pairs are required, along with the E2E URLs, the
Clerk development keys, and `DATABASE_URL`. A run missing any of them fails
before the first spec file is loaded, reporting only the missing variable
names — see [Settings these browser runs cannot go
without](#settings-these-browser-runs-cannot-go-without). An environment where
these checks are deliberately not expected sets `BROWSER_TESTS=skip`, and that
run says in its output what it left unverified.

`E2E_MODERATOR_EMAIL` and `E2E_MODERATOR_EMAIL_2` must be verified primary
emails for the configured administrator accounts, with the matching passwords.
The test never deletes or changes either administrator account; only each run's
disposable accounts and profile rows are cleaned up.
Store both email/password pairs in the protected `E2E_MODERATOR_EMAIL`,
`E2E_MODERATOR_PASSWORD`, `E2E_MODERATOR_EMAIL_2`, and
`E2E_MODERATOR_PASSWORD_2` environment variables; do not put their values in
commands or reports.

```sh
E2E_CHAT_URL="https://${REPLIT_EXPO_DEV_DOMAIN}" \
E2E_API_URL="https://${REPLIT_DEV_DOMAIN}" \
pnpm --filter @workspace/api-server run test:e2e:moderation --output /tmp/moderation-e2e
```

Back-to-back runs of this suite alone need no pause; a whole release chain
repeated back to back does, for which see "Running every suite before
publishing" above. Each administrator is signed in once per run
and every later case restores that browser session, so the cases no longer
repeat the sign-in calls that a development Clerk instance rate-limits. What
remains is one sign-in per administrator, one per disposable account, and the
calls the app itself makes while a case drives it. If a 429 does happen, it
surfaces as an empty account search or a missing history entry rather than as
an authentication error, so check the API server log before reading such a
failure as a bug in the app. It can also stop a case at a ban or restore whose
request never completes, which reads as a failure of the action rather than of
anything the case was checking.

This suite requires a Clerk **development** instance. It verifies each supplied
administrator password through Clerk's backend API, then uses a 60-second
sign-in ticket for that same user to establish the browser session; disposable
accounts are signed in with a ticket alone, since the suite created them and
already holds their IDs. Real moderator emails cannot use the synthetic
`424242` new-browser verification code. This is a moderation permissions check,
not a test of the normal password/email-code login UI. Passwords are never
typed into the browser or included in failure snapshots.

Each case still creates its own disposable accounts and removes them, along
with their profile, moderator, and history rows, when it ends. Only the
administrator sign-in and the sweep for accounts an earlier interrupted run
abandoned are shared, and a case that cannot establish its session fails on its
own without settling how the others end.

Each primary moderator case passed independently against the API and Expo
previews on 2026-09-24, covering search, ban, restore, hidden moderator controls
for ordinary members, and HTTP 403 denial of ordinary-member search and ban
requests. Final cleanup checks found zero disposable Clerk users and zero
disposable profile rows.

On 2026-09-26 the whole suite passed twice in a row with no pause between the
runs, about a minute each, and no rate-limited call in the API server log.
Cleanup checks after both runs again found no disposable accounts, profile,
moderator, or history rows left behind, and an empty recovery journal.

### Granting and revoking moderator access

The same suite contains one lifecycle case, run with the first configured
administrator: it grants moderator access to a disposable account from the
panel, then checks that the account's own next requests are treated as a
moderator's (its profile reports `isAdmin`, and an account search returns 200
instead of 403) and that its own copy of the app shows the moderation panel. It
then revokes the access from the panel and checks the same three signals are
gone. A failure names only the stage it stopped at.

Finally, it reads the panel's moderation history. Filtered to the account whose
access changed, the list must hold exactly two entries — one grant and one
removal — and each must name the administrator who made that change, compared
against that administrator's own row in the panel's moderator list rather than
a name the test supplies. Clearing the filter must still show those same two
entries, so a history the panel can only reach through a filter fails the case.
It adds no accounts or rows of its own beyond the two entries the grant and
revoke already write.

Granting writes a `moderators` row, so the fixture deletes that row along with
the disposable account and its profile row. It also deletes the
`moderation_actions` rows naming that account, whether written by the actions
the run performed or seeded by the paging case below. Cleanup runs even when a
case fails part way through, and the same deletions are used by the recovery
command below.

### Seeing a role change from inside an open room

A grant or a revocation is pushed to the affected account over its chat
connection, and every screen reads the role from there. The server side and the
app side each have their own test, so a rename of the event or of its payload
field would pass both and still leave a member's controls stuck until the app's
own re-read. One case drives the two halves together in the browser.

The administrator signs in, keeps the panel open on the profile screen, and
creates a room in a second tab of the same session. A disposable account joins
that room and opens its member list; it is not the room's creator, because a
creator can moderate their own room whatever their account-wide role is, and
somebody else has to be in the room for a ban control to be offered at all.
While that member sits there — no reload, no tab switch, no button press — the
administrator grants moderator access from the panel, and the in-room ban
control has to appear. Revoking it has to take the control away the same way.

Two things keep a pass honest. Each change has to land within a window far
below the app's own re-read interval, and the member's page must make no
profile request at all between the change and the control following it: a
pushed change carries the new role with it, so the app has nothing to ask. The
member list must still be open and the room still hold both people afterwards,
so a control missing from a closed list or an emptied room cannot pass for a
revocation.

This case passed against the API and Expo previews on 2026-09-26. A renamed
payload field on the server failed it where the control had to arrive, and a
server that pushed grants but not revocations failed it where the control had
to go. It creates one room, which it deletes afterwards; the row's membership,
message, and key rows go with it through the schema's cascades.

### Filtering the history by administrator

The panel's other history filter answers "what did this administrator change?",
the question asked when one administrator's decisions are reviewed. One case
covers it with both configured administrators: the first bans and restores one
disposable account and bans a second, then the second administrator restores
that second account. One account therefore carries actions from two different
administrators, and one carries actions from only the first.

The filter is applied all three ways it can be: by typing an administrator ID
into "Filter by admin ID", by choosing an administrator from the "Admin:"
picker, and by tapping an administrator's name on a history row. Each filtered
list must hold that administrator's own actions and none of the other
administrator's. Applying the administrator and account filters together must
narrow to the one action that matches both, dropping the same administrator's
actions on the other account. The administrator picked and the row tapped are
both the _other_ administrator's, so a picker or link wired to the row's
account, or to whoever is signed in, cannot pass. Every step waits for the
response to that exact query, and rows the filter must drop are checked after
rows it must add, so a list still showing the previous query cannot pass
either.

The picker is driven the way an administrator uses it: its option is found by
the name shown on it and only then checked against the id that option carries,
so a row labelled with one administrator while wired to another fails. Both
names come from the rows those administrators' own actions just wrote, not
from the test, and a name the identity provider does not return — which the
panel falls back to showing as an id — fails before the picker is opened.
Choosing an administrator must also keep the account filter in place and name
the picked administrator back on the closed picker, rather than showing the id
it filtered by.

A failure anywhere in this case is reported as one sentence naming the stage it
stopped at, and nothing else: the provider's own errors and the details the
sign-in used stay out of the report. Three of those stages check a whole set of
rows rather than a single one — the rows a filter has to show and the rows it
has to have dropped — so a stop inside one of them names the row as well: which
row of how many in that set, and whether it had to be on the list or gone from
it. The row is named by its place in the set and never in any other way, because
its test ID is an account's own id and the administrator's name beside it is an
account's too. So a stop in one of those sets says which row it was without the
case being instrumented again and re-run against the previews, and without an
account reaching the report.

This case passed against the API and Expo previews on 2026-09-26: a history
query that ignored the administrator filter, a per-row filter link wired to the
account instead of the administrator, a picker option wired to the account
filter, and a picker option carrying one administrator's id under another's
name each failed it, at the typed filter, the tapped one, and the picker
respectively. It leaves both administrator accounts untouched; its two
disposable accounts and their profile rows are removed by the same fixture as
the other cases, and it adds no rows beyond the four history entries its ban
and restore actions write.

The rows those sets name were checked on 2026-09-27, the case passing first on
the same previews. A history query ignoring the administrator filter — which
keeps every row that filter had to drop — failed it at the typed administrator
filter, row 4 of 4, which had to be gone from it. A query filtered to every
administrator _but_ the named one failed it at that same stage from the other
side, row 1 of 4, which had to be on the list. Both messages name the row's
place in the set only; neither carries an account id or a name. A run of this
case on a throttled development Clerk instance stops earlier than either, at
the second administrator's action, with the provider's 429 visible only in the
API server log — see the note on rate limits above before reading such a stop
as a filtering bug.

### Dismissing the administrator picker

The picker is a menu, and the ordinary way to dismiss a menu is to click away
from it. That cannot be checked outside a browser: the line describing what the
log records takes no focus, so nothing tells the picker where focus went, and
closing the list rests on the press itself travelling from the wording it
landed on out to the screen around the picker. A separate case covers the ways
focus _can_ report the same thing, from the keyboard alone: opening the picker
and choosing from it with the space bar, walking its open list with the arrow
keys, backing out with Escape, and tabbing back past the toggle.

That keyboard case walks the open list the way a list of choices is walked
elsewhere on the web, which Tab cannot do without a press per administrator.
Down enters the list at its first row and steps down it, Up steps back, Home
and End jump to its ends, and a step off either end stays on that end rather
than wandering into the filters around it. The rows expected are read from the
list the browser rendered, in the order it rendered them, so the walk is held
to the administrators on screen rather than to names written here, and the
element holding focus after every press is read from the browser itself.
Enter on the row the walk ends on has to run that administrator's query, close
the list, and name them on the closed picker; the walk ends on an
administrator other than the one chosen with the space bar just before, so the
query Enter runs is not the one already on screen.

Two things only a browser can show are checked alongside the focus at every
press: the row focus lands on has to be on the screen, and the screen behind
the list must not move. The second rule holds for every key the picker
answers, not only the ones that walk the list. The space bar that opens the
list scrolls a page by default exactly as those do, and Escape and Shift+Tab
close it, so each of those presses is read across as well: the offset the log
rests at is recorded before the key and required again once the key has been
answered. The open list is scrolled fully into view before the walk begins,
and the tab stop above the toggle before the press that leaves the picker,
because a browser scrolls whatever it focuses back into view and would
otherwise hide the page scroll these keys perform by default.

Each reading across a key is taken twice — the eight presses that walk the
list included — once as the key is answered and again once the screen has
stopped moving, because a browser animates the scroll a key asks for: the
first reading on its own is a race with that animation, catching a few pixels
of a scroll that ends hundreds away and, on a run that reads before the
animation starts, catching nothing at all; the settled one on its own would
forgive a screen jerked away and put back. Settling is read by repeating the
reading a tenth of a second apart until it stops changing, which costs the
case about a second across the whole walk. The press that opens the list must
also leave the log somewhere left to scroll to. Opening the list is what
makes that room — the picker sits at the end of the panel's own scrolling
view — and with none of it, nothing could have moved and the rule would pass
without having been asked anything.

The two keys that close the list are read with one allowance. Closing it takes
its rows out of the panel that scrolls, so the panel gets shorter by their
height; a screen resting inside the room those rows had made is then past the
end of what is left, and the browser has to pull it back to that end. That is
a scroll nothing did wrong, and the offset rule would report it as the log
jumping away. The administrators configured today cannot produce one — their
open list fits, and the log rests where the closed panel can still hold it —
but a taller list, or a shorter window, can. So a reading across Escape or
Shift+Tab may also be above where the screen was left with nothing below it
left to scroll to: as far back as the browser had to pull it, and no further.
The room left is read to the nearest pixel, because a browser reports the
panel's height rounded to one while the offset itself keeps its fraction.
Nothing else is forgiven — a pull-back past that end, a movement of any size
while the end is still below where the screen was left, and every reading
across the space bar that opens the list are all held to the offset itself.
The one thing the allowance cannot tell apart is a screen scrolled away that
ends at that same end, which the browser would have held there too.

A failure anywhere in this case is reported as one sentence naming the stage
it stopped at, and nothing else: the provider's own errors and the details the
sign-in used stay out of the report. Inside the walk the stage is the press —
its number, its key, and the place in the list it should have landed on —
followed by which of the three rules above it broke, and, where focus went
somewhere else, where it stopped. Every one of those is a position in the
list, never a row: a row is known here by a test ID which is an
administrator's account id, and the name beside it is an account's too. So a
stop in the walk says which of its eight presses it was without a
re-instrumented re-run, and without an account reaching the report.

The keyboard case passed against the API and Expo previews on 2026-09-26, on
its own and in a whole-suite run. Making `End` land one row short of the
list's end failed it inside the walk, naming the press it stopped on: press 5
of 8, `End`, expecting option 3 of 3, with focus stopped on option 2 of 3.
Making the picker ignore `ArrowDown` failed it earlier still, at the choice
made from the keyboard before the walk, which reaches the first administrator
below the option in effect with that same key. The other thing a missed press
can say — that focus stopped outside the list rather than on a row of it —
was measured on 2026-09-27 with a narrower break: `ArrowDown` was left
stepping between the rows and stopped only from entering the list from the
toggle, which nothing before the walk asks of it. The choice made from the
keyboard before the walk arrives on a row with Tab first, so it passed as it
does now, and the case reached the walk, whose first press left focus on the
toggle: press 1 of 8, `ArrowDown`, expecting option 1 of 3, with focus
stopped outside the list. Restored, the case passed again the same day.
Dropping the `preventDefault` from the walking keys failed it at the walk as
well, and only because the screen behind the list is read: every row was
still on screen, while the log behind them drifted a few pixels a press and
jumped once `End` reached it. It stopped at the first press of the walk —
press 1 of 8, `ArrowDown`, expecting option 1 of 3, on the screen behind the
list — and it stopped at that same press with the immediate reading taken out
of the rule, leaving only the settled one, so the walk no longer rests on a
reading that races the browser's scroll animation. Dropping the same
suppression from the space bar the toggle answers failed it at the opening
press, before any of the walk: the list opened and focus stayed on the
toggle, exactly as they should, while the log behind them had already left
the offset it was resting at. The
allowance across the closing keys was measured by putting the log where those
administrators do not: left resting at the end of the panel the open list had
made, 151px past what the closed one can hold, Escape pulled the log back to
that end and the case passed. Held to the offset alone, as it was before, that
same forcing failed it at backing out of the open picker — and so did pulling
the log 100px further back than the browser had to as the key was answered,
because a screen that moved more than it was made to is still the log jumping
away. Removing the picker's own `Enter` handling did not fail it, and is not
meant to —
react-native-web presses a focused element on that key by itself — so the
case holds the outcome, the query that ran and the list that closed, rather
than the layer that delivered the key. Like the pointer case below, it
touches no account, creates nothing, and writes no history rows.

One case covers the pointer. It uses the first configured administrator and the
session every other case shares, so it signs nobody in of its own, and it works
only what is already on the screen. It opens the picker, clicks the line above
the filters, and requires the list to be gone and the toggle to say so. It then
re-opens the picker and clicks an administrator's row, which has to run that
administrator's query, close the list, name them on the closed picker, and
leave their id in the field the typed filter reads. That second half is what
keeps the first honest: a dismissal acting on the press on its way _into_ the
picker would take the row out from under the click still travelling to it, and
the filter would never be applied. The administrator picked is read from the
open list rather than named here.

This case passed against the API and Expo previews on 2026-09-26. Detaching the
screen's own press handler failed it at the click away, with the list still
open; detaching the picker's failed it at the row, whose query never ran. It
touches no account, creates nothing, and writes no history rows.

### Paging past the first page of history

The server answers a history request with at most 50 rows, so the entries an
installation accumulates past that point are only reachable through "Load
more". One case covers that boundary, using the first configured
administrator. It creates two disposable accounts and seeds 58 history rows
for the first, with rows for the second interleaved between them, rather than
performing 58 real actions: the actions themselves are covered above, and what
is under test here is the paging around them.

Filtered to the first account, the panel must show its newest 50 rows. A
deliberately failed next-page request — the only request the case intercepts,
matched by its cursor — must leave those rows on screen and offer the button
again instead of leaving it in its loading state. The retry must then append
the remaining 8 older rows below the first 50, none of them repeated and none
belonging to the interleaved account, and stop offering more once they have
arrived. The interleaved rows are what make the account filter observable: they
sit inside the first account's id range, so a follow-up request that dropped
the filter would pull them into the appended page.

Two loaded pages then put the newest entries a long scroll above wherever the
reader has got to, so the same case carries on into the control that offers
them back. From the top of the log, and part way down the screen above it,
there must be no control: the newest entry has not gone anywhere yet. Scrolled
to the bottom of both pages it must appear, and using it must put the newest
entry itself back on screen — not the top of the profile screen, and not
wherever the log happened to be — after which it must go away again. The log
is scrolled by position rather than by wheel gestures so the case asks for an
exact place each time, and the newest entry is only required to be on screen
after the jump: the list stops rendering rows that are far off screen, so one
sitting below the fold cannot be looked for before then.

That control is then checked a second time on a phone-sized screen (402x874),
because this is a phone app and where the control lands depends on the size of
the screen it is drawn on: it is offset from the bottom by the screen's tab bar
clearance, and a phone puts the whole profile screen above the log out of sight
while rendering only a handful of rows. The same page is opened again at that
size for the same account and filter — the rows are already seeded and the
administrator's session is the worker's, so this costs no extra provider work —
and the control is driven through the same steps. At both sizes it must also be
placed where a finger would find it: drawn inside the screen, ending above the
tab bar, and the top-most thing at the point it would be tapped. Both of those
matter, because the bar's backdrop takes no pointer events, so a control hidden
underneath it can still answer a tap nobody can see to make, while a layer that
does take them leaves a control that looks offered and does nothing. The click
is given a deadline of its own: an unreachable control has none, and would
otherwise hold the case open to its whole budget instead of failing where it
broke.

This case passed against the API and Expo previews on 2026-09-25, with zero
`moderators` rows and an empty recovery journal afterwards, including after a
deliberately broken permission check, which it caught at the granted account's
first request. The history assertions were checked the same way on the same
date: a swapped actor/target mapping and a history query that ignored the
account filter each failed the case. The jump control was checked on
2026-09-26: a control that never rendered, one offered before the newest entry
had scrolled away, and one that jumped to the top of the screen instead of to
the newest entry each failed the case, the first and last where the control
had to appear and be used, the second where it had to stay away. The
phone-sized pass was checked the same day, on its own with the desktop-sized
pass disabled: a control whose bottom offset no longer cleared the tab bar
failed that stage in nine seconds, rather than holding the case open to its
timeout.

## Moderation timeout cleanup regression

Run `pnpm --filter @workspace/api-server run test:e2e:moderation-timeout` from
the workspace root. No browser, running app, or testing token is required: the
spec uses `moderation-accounts.fixture.ts`, which creates and removes the
disposable accounts, and never the signed-in pages built on it. The
command requires a development Clerk key pair, `DATABASE_URL`, and both configured
moderator email/password pairs — stated once as `MODERATION_TIMEOUT_COMMAND` in
`lib/browser-test-requirements/src/index.ts`, which is what the verifier checks
before it opens the database or reaches Clerk. A run missing any of them stops
there, naming the ones this environment does not provide (their names only,
never their values), having created nothing. `pnpm run check:command-requirements`
holds that list to what the verifier and the helpers it hands `process.env` read,
and to what the Playwright run it starts cannot start without: the declaration
names that run, `MODERATION_TIMEOUT_SUITE`, so a setting added to the suite is
required here too, and refused here by name rather than inside a child process
whose output this command never prints. That run checks the keys and database
connection its fixture needs again in `moderation-timeout.requirement.ts`. That
is the one requirement module that ignores `BROWSER_TESTS=skip`: this run is
never part of a repository-wide one, so a run started by the verifier is a run
someone asked for. Each moderator's existing profile state (present or absent)
must remain unchanged; the test does not create profiles for moderators.

This dedicated Playwright test creates two real Clerk users and matching profile
rows, then deliberately exceeds its actual Playwright timeout. The separate
verifier requires exactly one `timedOut` result, checks both disposable Clerk
IDs return 404 and their profile rows are gone, and confirms both configured
moderator accounts and profile rows are unchanged. Unexpected outcomes fail the
command, with fallback deletion limited to recorded disposable IDs. Temporary
reporter files are kept outside the repository and removed after verification;
provider errors and credentials are not printed.

## Interrupted moderation-run recovery

The fixture writes an ownership intent to `.local/moderation-recovery/` (relative
to the API package working directory) **before** calling Clerk. Each account has
a random run ID and account token in both this private journal and Clerk private
metadata. Keep this ignored directory across worker restarts; it contains no
passwords, sign-in tokens, or keys. Do not copy it between environments or edit
its ownership evidence. The local journal is trusted test infrastructure.

Before creating accounts, the fixture recovers abandoned intents between **6 hours
and 30 days** old. Its own teardown can clean its current run immediately. After
a killed worker, either start the suite again after six hours or run:

```sh
pnpm --filter @workspace/api-server run e2e:moderation-recover
```

This command does not create accounts or need a browser. It requires development
Clerk keys, the development `DATABASE_URL`, and both moderator email exclusions —
stated once as `MODERATION_RECOVERY_COMMAND` in
`lib/browser-test-requirements/src/index.ts`, which is also what the command
checks before it opens the database or reaches Clerk. A run missing any of them
stops there, naming the ones this environment does not provide (their names only,
never their values) and listing what it would have gone on to delete, having
created and deleted nothing. `pnpm run check:command-requirements` holds that
list to what the command and the recovery helpers it hands `process.env` really
read, so a setting added to either is declared or the check fails.
It refuses production/deployment mode or live keys. Both moderators are resolved
before any deletion; all `ADMIN_USER_IDS` and accounts with either moderator email
are excluded. Exact intent email, private ownership metadata and creation-time
agreement are required, never substring searches. Only a proven Clerk user's own
rows are deleted: its profile row and any moderator grant left by an interrupted
lifecycle run. Verified IDs remain journaled until DB cleanup
succeeds, including when Clerk already deleted the account. Unknown create
responses remain recoverable through their exact intent email. Accounts without
this journal/metadata or older than 30 days require manual investigation; no
broad legacy-account cleanup is attempted.

`pnpm --filter @workspace/api-server run test:e2e:moderation-recovery` runs offline
regressions for lost create responses, actual child-worker SIGKILL, profile retry,
age boundaries, ownership mismatch, production refusal, and moderator/admin
preservation. These tests use an in-memory Clerk substitute and temporary files;
they do not mutate live accounts or log credentials.

### Opt-in live Clerk recovery verification

```sh
MODERATION_RECOVERY_LIVE=1 pnpm --filter @workspace/api-server run test:e2e:moderation-recovery-live
```

This separate integration check needs the opt-in above, development Clerk keys,
the development `DATABASE_URL`, and both existing moderator email exclusions —
`MODERATION_RECOVERY_LIVE_COMMAND` in the same module, checked the same way
before the worker that creates an account is forked, and `MODERATION_RECOVERY_LIVE`
is required here rather than optional because the run it makes without the opt-in
is no run at all. No browser or moderator passwords are needed. It refuses missing
opt-in, production/deployment mode, live keys, and missing or ambiguous moderators
before creating anything.

It is the one suite `pnpm run release:validate` leaves out, declared with that
reason in `LEFT_OUT_SUITES` in `scripts/src/checkReleaseSuites.ts`; the offline
regressions above back it up on every release run.

It snapshots both moderators' full Clerk accounts and existing/absent DB profiles,
persists one new disposable intent, and kills a child worker after Clerk accepts
the create but before any returned ID is journaled. Fresh reads verify exact-email
reconciliation and private ownership metadata persistence. It inserts only that
proven disposable user's profile, confirms ordinary recovery protects the recent
run, then uses the existing **own-current-run teardown** exception to verify Clerk
404, matching profile absence, empty journal, and idempotent retry. It does not
backdate metadata, change the clock, or weaken the 6-hour/30-day age guards.
Moderator snapshots are compared even after failure.

Failure cleanup uses the same ownership and moderator guards, scoped to this
verifier's token; it never sweeps other runs. Unresolved intent evidence remains
in `.local/moderation-recovery/` for the guarded recovery command after the normal
minimum age. Output contains phase labels only, not IDs, emails, credentials,
provider errors, or snapshots. A pass confirms the live provider/DB contract;
the offline suite remains responsible for exhaustive age and ownership cases.
