# Security Policy

Hakka is a local-first network inspector: SDKs that run inside your app, a
desktop bridge, and an MCP server, all on your machine. No cloud, no accounts.
This policy covers how to report a vulnerability and what's in scope.

## Supported versions

Hakka is pre-1.0 (`0.x`) across every package. There is no long-term-support
branch yet — the **latest published minor** of each package is the only
supported line. Upgrade before reporting if you're not on the latest release.

| Package                              | Supported         |
| ------------------------------------ | ----------------- |
| `hakka-core`                         | latest `0.x` only |
| `hakka-react-native`                 | latest `0.x` only |
| `hakka-browser`                      | latest `0.x` only |
| `hakka-node`                         | latest `0.x` only |
| `hakka-bridge`                       | latest `0.x` only |
| `hakka-rozenite`                     | latest `0.x` only |
| `hakka` (CLI)                        | latest `0.x` only |
| Android SDK (`com.noodleapps.hakka`) | latest `0.x` only |
| iOS SDK (Swift package)              | latest `0.x` only |

Once a `1.0` ships, this table will name a supported range instead of "latest
only."

## Reporting a vulnerability

**Preferred: [GitHub Security Advisories](https://github.com/ansumanshah/hakka/security/advisories/new).**
This opens a private report visible only to the maintainer until a fix is
ready — please use it instead of a public issue for anything with real
security impact (credential exposure, RCE, auth bypass, etc.).

**Fallback:** email **ansumanshah@gmail.com** if you can't use GitHub
Advisories for some reason. (Note: the npm `package.json` `author` field on
every Hakka package is a bare `"Ansuman Shah"` string with no email — this
address is the maintainer's actual contact, sourced from the GitHub profile
and commit history, not from `package.json`.)

Please include:

- Which package(s) and version(s)
- Reproduction steps or a minimal repro
- Impact — what an attacker gains and under what conditions (e.g. "local
  process on the same machine," "same LAN when the bridge is opened past
  loopback," "AI agent with MCP tool access")

Please do not open a public GitHub issue for a vulnerability before a fix is
available.

## Response time

Hakka is maintained by one person. You can expect:

- **Acknowledgment within 7 days.**
- A fix timeline communicated once the report is triaged — severity and
  reproducibility drive priority, not a fixed SLA.
- Credit in the advisory and changelog, unless you ask to stay anonymous.

## Scope

**In scope:**

- All published npm packages: `hakka-core` (and its `/test` subpath),
  `hakka-react-native`, `hakka-browser` (and its `/vite`, `/webpack`,
  `/rspack`, `/elements/*`, `/react` subpaths), `hakka-node` (and its `/next`,
  `/next/server`, `/next/client` subpaths), `hakka-bridge`, `hakka` (CLI, and
  its `/mcp`, `/cdp` subpaths)
- The Android SDK (`hakka-network`, `hakka-performance`, `hakka-ui` and their
  `-noop` counterparts, `hakka-common`)
- The iOS SDK (`HakkaNetwork`, `HakkaPerformance`, `HakkaUI`, `HakkaCommon`)
- The desktop bridge protocol and hub (`packages/hakka-bridge`)
- The MCP server and the tools it exposes to AI agents (`packages/hakka-cli/src/mcp`)

**Out of scope:**

- Example / demo apps (`examples/*`, `android/example`, `ios/Example`,
  `packages/hakka-react-native/examples/*`) — these exist to exercise the SDK,
  are not shipped to end users, and are not held to the same bar
- The docs site (`docs/`) and marketing content, unless the issue is a
  documented security or privacy claim that's actually false — e.g. a
  redaction default described incorrectly, or a gap from the [bridge threat
  model](https://hakka.noodleapps.com/reference/security/). Report
  inaccuracies like that too, they matter.
- Denial-of-service via resource exhaustion on your own local dev machine
  (e.g. flooding your own bridge hub) — the bridge is a local dev tool, not a
  hardened network service; see the threat model above for what it does and
  doesn't defend against
- Vulnerabilities that require the release/production build of an app (Hakka
  ships no-op artifacts for production by design — see [Production
  safety](https://hakka.noodleapps.com/guides/production-safety/))
