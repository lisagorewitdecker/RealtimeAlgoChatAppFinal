# Security Policy

## Supported Versions

This repository is currently pre-release (`0.0.0`). Security updates are
provided for the latest code on the `main` branch.

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| all tags/releases | :x:       |

## Reporting a Vulnerability

Please report vulnerabilities using
[GitHub Security Advisories](../../security/advisories/new).
Include reproduction steps and impact details.

After you submit a report, maintainers will acknowledge it within 5 business
days and provide status updates as the investigation progresses.

## Security remediation — October 2026

This pass fixes ten dependency advisories, but is **not a complete security
clearance or a deployable backend release**. Missing backend source files
prevent a rebuild and leave the account-metadata issue below unresolved.

| Dependency | Secure override | Reason |
| ---------- | --------------- | ------ |
| `body-parser` | `2.4.0` | Prevent process crashes from compressed requests with trailing bytes (GHSA-27r3-jxmh-p828). |
| `markdown-it` | `14.3.3` | Fix three quadratic-time parsing/rendering denial-of-service advisories. |
| `undici` | `6.29.1` | Bound EventSource parsing and handle excessive content encodings safely. |
| `fast-uri` | `3.1.9` | Fix encoded-scheme injection, host confusion, and path/reference normalization. |

These overrides preserve the existing major versions and one-day minimum
release age. The lockfile includes the required `iconv-lite` transitive update.
No runtime environment variables change.

The sole audit exception, GHSA-86w9-cpqp-85rv, is already fixed by
`patches/node-forge@1.4.0.patch`. Version-only audit results cannot recognize this
backport. `auditConfig.ignoreGhsas` excludes only this advisory; mandatory CI
regressions verify that malformed/extra nested DigestAlgorithm elements fail
verification and valid signatures (including omitted NULL parameters) work.
Replace the patch and remove the exception when a fixed upstream release is
available; do not use blanket advisory or severity exclusions.

### Regression checks

The dependency-security workflow runs on pull requests, main pushes, a weekly
schedule, and manual dispatch. It uses Node 22 and pnpm 11.28.8, installs with a
frozen lockfile and dependency lifecycle scripts disabled, runs all
`scripts/tests/*Security.test.ts` suites, and blocks on **low or higher**
advisories except the tested backport above. Registry errors remain failures.
The existing JavaScript/TypeScript CodeQL workflow now uses `security-extended`
queries; no additional lint tool is required.

Run locally from the repository root:

```sh
corepack pnpm@11.28.8 install --frozen-lockfile --ignore-scripts --config.strict-dep-builds=false
node --test scripts/tests/*Security.test.ts
corepack pnpm@11.28.8 audit --audit-level low
pnpm run test:unit
```

The compressed-request regression starts a loopback HTTP server, sends a
malformed gzip request, and checks that subsequent valid requests still work.
URI regressions reject percent-encoded executable schemes.

### Residual risks and required follow-up

- **Account moderation race:** the committed API bundle's profile/identity
  updates replay entire Clerk private-metadata snapshots, which can overwrite
  a concurrent account ban. Restore the missing
  `artifacts/api-server/src/lib/accountProfile.ts` and `accountAccess.ts`.
  Restrict each Clerk `updateUserMetadata` payload to its owned namespace
  (`devStudioProfile`/`devStudioProfileIdentity` versus `devStudioAccess`);
  do not spread unrelated metadata. Add a deferred-write regression proving
  a concurrent profile update cannot undo a ban, then rebuild and redeploy.
- The checkout lacks 33 backend source modules, including routing, Socket.IO,
  authentication helpers, and origin validation. Relevant bundled/source-map
  implementations were reviewed, but some source-map copies differ from
  current source. No additional high-confidence injection, XSS, weak-crypto,
  prototype-pollution, CORS, or traversal exploit was established in the
  available code; that is not proof that missing implementations are safe.
- The API test command cannot load
  `src/testing/databaseTestRequirement.ts`; typechecking cannot find
  `lib/api-client-react/tsconfig.json`; the API build cannot resolve missing
  modules. Restore the complete source tree and rerun tests, typechecks,
  builds, and authenticated HTTP/socket security tests before deployment.
- **Rebuilding is required:** `artifacts/api-server/package.json` starts the
  committed `dist/index.mjs`, which embeds old dependencies. Lockfile updates
  do not patch that bundle. This pass does not hand-edit generated bundles.
- Validate deployed TLS/proxy trust, origin allowlists, Clerk session/cookie
  settings, security headers, and secret rotation separately. Stored GitHub
  code/secret-scanning alerts were not accessible to this task's integration.
  Retain server-only credentials in environment secrets, never client config.
