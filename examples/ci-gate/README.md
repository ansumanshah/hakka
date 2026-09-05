# CI gate worked example

Network capture as a CI gate: a test suite records its own traffic and gets checked against a
committed baseline, failing the build on meaningful drift. Full design rationale:
`docs/src/content/docs/spec/ci-gate.md`.

`server.mjs` is a tiny two-endpoint "app under test". `ciGate.test.ts`
(`bun test examples/ci-gate/ciGate.test.ts`) runs four scenarios, each
proving a different slice of the shipped `hakka-node` surface:

1. **`hakka-node`'s root export** (`register`/`startCapture`) — the thing every doc leads with,
   capturing a plain `fetch` with no CI wrapper at all.
2. **`hakka-node/ci`'s contract-drift check**, called directly: a clean second run passes; a
   client that starts sending a request-body field it never sent before fails the build
   (requirement #4 in the repo prompt, verbatim), and the actual plain-text CI-log report
   (`formatDriftReport`) is asserted on too.
3. **Exfiltration detection** (`findExfiltrationFindings`) — the feature's own headline
   capability: a credential-shaped field sent to a host outside the baseline.
4. **The real `hakka ci-baseline record|check` CLI**, spawned as a user would actually run it —
   the file I/O, exit codes, and combined report that calling the pure functions directly (1-3)
   never exercises. These two tests `skipIf` child-process spawning isn't available (some
   sandboxed runners restrict it) or `hakka-cli` hasn't been built yet — its `dist/` is
   gitignored, so run `bun run --cwd packages/hakka-cli build` once first.

All four import from the published `hakka-node`/`hakka-node/ci` subpaths, not repo-relative `src`
paths, so this test proves what installing the package actually gets you.

## Wiring it into a real CI job

A real test suite doesn't call `diffBaseline` directly — it records to a `.hakka` file and lets
the CLI do the normalize/diff/report/exit-code work (scenario 4 above does exactly this). Two
pieces:

**1. Test setup/teardown** (`beforeAll`/`afterAll`, any framework):

```ts
import { startCiCapture } from 'hakka-node/ci'

let capture: ReturnType<typeof startCiCapture>

beforeAll(() => {
  capture = startCiCapture()
})

afterAll(() => {
  capture.stop('ci-capture.hakka') // written to disk, share-scrubbed
})
```

Run the suite exactly as normal — every `fetch`/`http` call the app under test makes during the
run gets captured automatically.

**2. CI job step**, after the test suite has produced `ci-capture.hakka`:

```sh
npm i -g hakka-cli   # or: npx hakka-cli ci-baseline ... for a one-off, no install

# First time only, to create the baseline — commit the result and review the diff:
hakka ci-baseline record ci-capture.hakka hakka-baseline.txt

# Every CI run after that — this is the actual gate:
hakka ci-baseline check ci-capture.hakka hakka-baseline.txt
```

`hakka ci-baseline check` exits non-zero on any FAIL finding (contract drift or an exfiltration
signal), with a plain-text report in the CI log — no colour, so it reads fine piped through a
CI provider's log viewer. When drift is intentional, re-run the `record` step locally, review
`git diff hakka-baseline.txt`, and commit it — that review IS the contract check.

Run `bun install --frozen-lockfile` at the repository root first. This example is a private workspace so its imports resolve the local SDK packages.
