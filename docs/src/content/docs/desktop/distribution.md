---
title: Signing and distribution
description: What it takes to get a signed, notarized Hakka.app onto someone else's Mac. The Developer ID certificate, notarytool, the entitlements this app actually needs, and what auto-update would require.
---

**Status: not done.** `Scripts/package_app.sh` produces a real, launchable `.app` today, but
it is adhoc-signed. An adhoc-signed build only opens on the machine that built it: Gatekeeper
rejects it the moment it is quarantined (downloaded, AirDropped, unzipped from a release
asset). Nobody outside the machine that ran `package_app.sh` can install Hakka until it goes
through Apple's notarization service with a Developer ID certificate. This page is that path,
plus the [`release-desktop.yml`](https://github.com/ansumanshah/hakka/blob/main/.github/workflows/release-desktop.yml)
workflow that runs it in CI.

## What's already built

- `Scripts/package_app.sh` assembles `Hakka.app` from the SwiftPM build output: Info.plist,
  icon, bundle id, `MARKETING_VERSION`/`BUILD_NUMBER` from `version.env`, universal binary
  (arm64 + x86_64) via `lipo`.
- `Scripts/sign-and-notarize.sh` runs the full release sequence below, already scripted: sign,
  notarize, staple, zip. It only needs a Developer ID certificate and notarytool credentials
  to exist somewhere it can find them.
- `.github/workflows/release-desktop.yml` runs both of the above in CI, gated so a run
  without secrets configured still succeeds (build, test, package, upload an adhoc-signed
  artifact) and only skips the signing/notarization/release steps.

What's missing is entirely credentials: a Developer ID Application certificate and an
app-specific password. Neither can be created by an agent since both require signing in as
the Apple Developer account holder. The rest of this page is what to do with them once you
have them.

## The Developer ID certificate

Gatekeeper trusts exactly one kind of certificate for software distributed outside the Mac
App Store: **Developer ID Application**. An "Apple Development" certificate (what Xcode uses
for local debugging) cannot notarize: submissions signed with it are rejected outright. Since
this app is not sandboxed (see below), it was never a Mac App Store candidate anyway, so
Developer ID is the only certificate type relevant here.

To create one (requires an active Apple Developer Program membership):

1. Xcode → Settings → Accounts → select your team → **Manage Certificates…** → **+** →
   **Developer ID Application**. Xcode generates the key pair and the certificate in one step
   and installs it in your login keychain.
2. Verify it's there:
   ```bash
   security find-identity -v -p codesigning | grep "Developer ID"
   ```
   `Scripts/sign-and-notarize.sh` picks this identity up automatically: it greps for exactly
   this string if `APP_IDENTITY` isn't set explicitly.

For CI, export it instead of leaving it in a personal keychain. Keychain Access → select the
certificate → right-click → **Export…** → save as a `.p12`, set an export password. Then:

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
```

That's the value for the `MACOS_CERTIFICATE_P12_BASE64` secret (see [CI secrets](#ci-secrets)
below). The export password is `MACOS_CERTIFICATE_PASSWORD`.

## The app-specific password

`notarytool` authenticates as your Apple ID, and an account with two-factor authentication
(every Apple Developer account) cannot use the account password directly from the command
line. It needs an **app-specific password**:

1. Sign in at [appleid.apple.com](https://appleid.apple.com), then **Sign-In and Security** →
   **App-Specific Passwords** → generate one, label it something identifiable like
   `hakka-notarization`.
2. Locally, store it as a reusable keychain profile rather than typing it every release:
   ```bash
   xcrun notarytool store-credentials hakka \
     --apple-id <your-apple-id> --team-id BR3WT6376A --password <the-app-specific-password>
   ```
   `sign-and-notarize.sh` looks for a profile named `hakka` by default (`NOTARY_PROFILE` env
   var to override). This is the one-time setup already documented in the comment at the top
   of that script.
3. For CI, there's no persistent keychain to store a profile in ahead of time. The release
   workflow creates a throwaway keychain per run and calls `notarytool store-credentials` fresh
   each time, using the `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD` secrets.

## The notarytool submit and staple sequence

This is what `Scripts/sign-and-notarize.sh` already runs, in order:

```bash
# 1. Universal release build + bundle assembly (package_app.sh), then sign
#    every embedded binary and the app itself with hardened runtime.
codesign --force --timestamp --options runtime --sign "$APP_IDENTITY" \
  --entitlements "$APP_ENTITLEMENTS" "$APP_BUNDLE"

# 2. Notarization needs a zip, not a raw .app. ditto (not zip(1)) preserves
#    the code signature's resource fork correctly.
ditto --norsrc -c -k --keepParent "$APP_BUNDLE" "$NOTARIZE_ZIP"
xcrun notarytool submit "$NOTARIZE_ZIP" --keychain-profile hakka --wait

# 3. Staple the notarization ticket to the .app so it opens offline too.
#    Without this, Gatekeeper has to phone Apple on first launch.
xcrun stapler staple "$APP_BUNDLE"

# 4. Verify both checks actually pass before calling it done.
spctl -a -t exec -vv "$APP_BUNDLE"
xcrun stapler validate "$APP_BUNDLE"
```

`--wait` blocks until Apple's automated scan finishes, usually a few minutes. If it rejects
the submission, `xcrun notarytool log <submission-id> --keychain-profile hakka` returns the
specific reason. It's almost always a missing hardened-runtime flag or an unsigned nested
binary, neither of which applies here since `package_app.sh` already signs every embedded
binary and framework inside-out before signing the outer bundle.

One easy way to fail this step: re-submitting the same `BUILD_NUMBER`. Apple rejects a
duplicate upload outright. Bump `BUILD_NUMBER` in `version.env` (and `MARKETING_VERSION` for
an actual release) before every re-run.

## Hardened runtime and entitlements

Hardened runtime (`codesign --options runtime`) is mandatory for notarization. Apple simply
refuses to notarize a binary without it. It restricts things like loading unsigned code and
debugger attachment by default, with specific restrictions individually opted back in through
entitlements. This app opts into none of them: `APP_ENTITLEMENTS` resolves to an entitlements
file containing an empty `<dict/>`, and that emptiness was checked against what the app
actually does, not assumed.

**This app is not sandboxed.** There is no `com.apple.security.app-sandbox` entitlement, and
that's a deliberate, existing decision (see the [desktop overview](/desktop/overview/) and
[ADR 0008](/contributing/adr/0008-desktop-plugin-products/)). The app binds a local server,
which App Sandbox complicates for no benefit here since this is a developer tool run by the
person who owns the machine. This matters for entitlements specifically because **the
`com.apple.security.network.client` and `com.apple.security.network.server` entitlements only
do anything under App Sandbox.** They gate network access for a sandboxed process; hardened
runtime alone does not restrict sockets at all. So even though `apps/hakka` does real network
work, none of it needs a network entitlement:

- **`Sources/Server/BridgeServer.swift`** binds an `NWListener` for the bridge hub (default
  port 8989). `parameters.acceptLocalOnly = !options.allowLAN` and `allowLAN` defaults to
  `false`, so out of the box this only ever accepts loopback connections. No entitlement is
  needed either way, sandboxed or not.
- **`Sources/Core`** makes outbound calls via `URLSession` (the request runner, OAuth2 flows)
  and via `GRPCNIOTransportHTTP2Posix` (gRPC sending, ADR 0012). Both are plain outbound
  connections that hardened runtime and code signing have no opinion on absent sandboxing.

The one entitlement genuinely worth flagging for later, not now: `BridgeServer` can advertise
itself over Bonjour (`_hakka._tcp`), but only `if options.advertise, options.allowLAN`, both
off by default. If a future release exposes LAN mode as a real user-facing setting, macOS's
Local Network privacy control (the "Hakka would like to find devices on local networks" TCC
prompt) applies to that path independent of sandboxing, and `Info.plist` would need
`NSLocalNetworkUsageDescription` and `NSBonjourServices` added so the prompt has something to
show instead of the feature silently failing. That is not required today because the shipped
default never exercises Bonjour, and adding those keys now would describe a permission the app
doesn't yet ask for.

**No JIT entitlement either.** The rules engine's scripting runtime runs on JavaScriptCore's
interpreter, not its JIT (see the README's "ships no JIT entitlement" note), which is the
correct call for a hardened-runtime app whose scripts come from a rule the user wrote, not
from a trusted bundle.

Net: nothing in `APP_ENTITLEMENTS` needs to change to ship a notarized build of what exists
today. Re-check this section if `apps/hakka` gains sandboxing, a helper XPC service, camera or
microphone access, or the LAN-mode Bonjour path described above. Any of those would need real
entries added, not an empty file kept out of habit.

## CI secrets

`release-desktop.yml` is a `workflow_dispatch` job, matching `release-ios.yml`'s and
`release-android.yml`'s convention: pass the version you're releasing, and it verifies that
against `apps/hakka/version.env` before doing anything. It always builds, tests, and packages
an adhoc-signed `.app`, uploaded as a build artifact regardless of secrets. The following six
secrets, set under **Settings → Secrets and variables → Actions**, additionally gate signing,
notarization, and publishing a GitHub Release:

| Secret                         | What it is                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MACOS_CERTIFICATE_P12_BASE64` | The Developer ID Application cert and private key, exported as a `.p12` and base64-encoded (see above).                                                                                    |
| `MACOS_CERTIFICATE_PASSWORD`   | The password the `.p12` was exported with.                                                                                                                                                 |
| `MACOS_KEYCHAIN_PASSWORD`      | Any password for the throwaway keychain the workflow creates per run. Not an Apple credential; it just has to exist so `security create-keychain` has something to lock the keychain with. |
| `APPLE_ID`                     | The Apple ID email used for notarization.                                                                                                                                                  |
| `APPLE_TEAM_ID`                | The Developer Team ID (`BR3WT6376A`).                                                                                                                                                      |
| `APPLE_APP_SPECIFIC_PASSWORD`  | The app-specific password from appleid.apple.com, scoped to notarization.                                                                                                                  |

Without all six present, the workflow logs a warning and skips straight to uploading the
adhoc-signed artifact. It does not fail the run. This is what keeps a fork, or this repo
before secrets are configured, from going red on every dispatch.

What the workflow deliberately does not do: update the Homebrew tap. That step lives only
in the local `Scripts/make_release.sh` flow, which depends on a tap checkout on the releaser's
own machine (`~/Code/homebrew-tap`) and the private/public branch guard described in that
script's header. Neither one makes sense to reproduce inside a CI runner.

## Auto-update: not wired

There is no update mechanism in `apps/hakka` today: no update-check code, no appcast feed, no
`Sparkle` dependency in `Package.swift`. A user who installs a release has to notice a new one
exists and reinstall by hand. This section describes what adopting Sparkle would look like; it
is a separate decision from everything above, not a partially-done feature. The gap between "we
can notarize a build" and "the app can tell you a new one exists" is real and unaddressed.

[Sparkle](https://sparkle-project.org) is the standard choice for this on non-App-Store macOS
apps and is what the `macos-spm-app-packaging` skill's `make_appcast.sh` template targets. That
template exists in the skill's asset library but has not been copied into this repo, because
nothing here consumes an appcast yet. Adopting it would mean:

1. Add the `Sparkle` SPM package as a dependency of the `HakkaApp` executable target.
2. Generate an EdDSA key pair (`generate_keys` from Sparkle's `bin/`) and wire the public key
   into `Info.plist` as `SUPublicEDKey`, keeping the private key out of the repo entirely. It
   would need to become a new CI secret alongside the six above.
3. Add `SUFeedURL` to `Info.plist` pointing at a hosted `appcast.xml`, and a "Check for
   Updates…" menu item that hands off to `SPUStandardUpdaterController`.
4. Host the appcast feed itself somewhere durable. GitHub Pages and the `noodleapps.com` site
   are the two natural candidates already in this ecosystem, neither currently set up for it.
5. Extend the release workflow to sign the built zip with Sparkle's `sign_update` tool and
   append (not replace) an `<item>` to the appcast on every release, in the same step that
   currently creates the GitHub Release.

A minimal appcast entry, for concreteness. This is the shape `sign_update` and
`make_appcast.sh` produce, not anything currently generated by this repo:

```xml
<item>
  <title>Hakka 0.2.0</title>
  <pubDate>Wed, 02 Sep 2026 10:00:00 +0000</pubDate>
  <sparkle:version>2</sparkle:version>
  <sparkle:shortVersionString>0.2.0</sparkle:shortVersionString>
  <sparkle:minimumSystemVersion>15.0</sparkle:minimumSystemVersion>
  <enclosure
    url="https://github.com/ansumanshah/hakka/releases/download/v0.2.0/Hakka-0.2.0.zip"
    sparkle:edSignature="…"
    length="10171624"
    type="application/octet-stream" />
</item>
```

None of this is built. Treat it as the shape of the next piece of work, not a description of
what ships today.
