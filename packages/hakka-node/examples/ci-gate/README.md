# CI gate worked example

Network capture as a CI gate: a test suite records its own traffic and gets checked against a
committed baseline, failing the build on meaningful drift. Full design rationale:
`docs/src/content/docs/spec/ci-gate.md`.

`server.mjs` is a tiny two-endpoint "app under test". `ciGate.test.ts` exercises the whole
pipeline directly (`bun test packages/hakka-node/examples/ci-gate/ciGate.test.ts`) and shows both
a clean pass and the FAIL case a new, unreviewed request-body field produces.

## Wiring it into a real CI job

A real test suite doesn't call `diffBaseline` directly — it records to a `.hakka` file and lets
the CLI do the normalize/diff/report/exit-code work. Two pieces:

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
# First time only, to create the baseline — commit the result and review the diff:
hakka ci-baseline record ci-capture.hakka hakka-baseline.txt

# Every CI run after that — this is the actual gate:
hakka ci-baseline check ci-capture.hakka hakka-baseline.txt
```

`hakka ci-baseline check` exits non-zero on any FAIL finding (contract drift or an exfiltration
signal), with a plain-text report in the CI log — no colour, so it reads fine piped through a
CI provider's log viewer. When drift is intentional, re-run the `record` step locally, review
`git diff hakka-baseline.txt`, and commit it — that review IS the contract check.
