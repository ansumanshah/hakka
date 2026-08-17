# Record Fixtures v1

These fixtures pin the serialized record contract shared by TypeScript, Kotlin,
and Swift.

## Rules

- Fixture files are schema fixtures, not demos. Keep them small, deterministic,
  and hand-reviewable.
- Every fixture must include `kind`, `schemaVersion`, `timestamp`, and all stable
  fields required by that record kind.
- Update fixtures only with an intentional schema change or OTel semantic
  convention version change.
- When `schemaVersion` changes, add a new version directory instead of mutating
  older fixtures in place.
- Platform tests should compare against these shared files rather than copying
  expected JSON into language-local test code.

## Adding a New Fixture

1. Create `<record-kind>.json` and `<record-kind>-minimal.json` in this directory.
2. The full fixture includes all stable fields. The minimal fixture omits all
   optional fields — absent means omitted, not `null`.
3. Reference both files from the relevant unit/snapshot test in each platform SDK
   (TypeScript, Kotlin, Swift) rather than inlining expected JSON.

## Current Boundary

`trace.json`, `trace-minimal.json`, `health-report.json`, and
`health-report-minimal.json` are exact serialized records. The minimal fixtures
intentionally pin absent optional fields as omitted, not `null`.
`network-request.json` pins the Hakka envelope, attributes, and stable request
projection. The full nested `NetworkRequest` payload is intentionally deferred
because current platform serializers differ on multi-value headers and nil/null
field emission. Normalize that payload before adding a full-network fixture.
