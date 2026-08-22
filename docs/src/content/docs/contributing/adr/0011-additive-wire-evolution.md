---
title: 'ADR 0011 — Additive wire evolution: optional fields and tolerant decoders, never a version bump'
description: How the bridge and control contracts grow — additive optional fields, unknown-kind tolerance, shared fixtures — proven by the headerValues and console/storage changes.
---

Status: Implemented · Date: 2026-08-22 · Applies [ADR 0009](/contributing/adr/0009-contracts-first-internals/)

## Context

The wire contracts (bridge frames on :8989, control commands, the mock rule
shape) are spoken by four runtimes that do not update together: a user's app
ships an SDK months older than the desktop inspecting it, and vice versa.
This sprint needed three contract changes at once:

- Mock rules had to carry multiple values per response-header name —
  RFC 6265 forbids comma-folding `Set-Cookie`, and the single-value map was
  silently dropping the second cookie.
- Captured requests had the same defect one layer down: `hakka-node` folded
  multi-value headers at capture time, so nothing downstream could recover
  them.
- The desktop needed console entries and storage snapshots from SDKs, but
  `BridgeFrameKind` carried only `request`, `span`, and `control`.

Each change had to land without breaking a single existing sender or
receiver.

## Options considered

**A. Widen the existing fields in place** (`headers` becomes
`Record<string, string[]>`). Honest types, but every consumer of the old
shape across four runtimes breaks at once — dozens of call sites in HAR
export, UI, interop, and share scrubbing for the header change alone.

**B. Version the envelope** (a `v` field, decoders branch per version).
Standard, and wrong at this scale: four runtimes × N versions of branching
decode logic, for contracts whose changes are almost always "carry more."

**C. Additive evolution.** New data rides in new optional fields beside the
old ones; the old field keeps a representative value; decoders ignore what
they do not recognize.

## Decision

Option **C**, as three enforceable rules:

1. **New data is a new optional field.** `MockResponse.headerValues` and
   `NetworkRequest.responseHeaderValues` sit beside the single-value maps
   they widen. The old field keeps a folded representative value so every
   old reader keeps working; the new field carries the real ordered list
   only for names with 2+ values. Readers prefer the wide field when
   present.
2. **Unknown frame kinds are dropped, not thrown.** `console` and `storage`
   could ship because every decoder already returned null/nil for an
   unrecognized kind — and that tolerance is now pinned by tests in TS and
   Swift, so the next kind is also free. A decoder that errors on unknown
   input is a contract bug.
3. **Every wire change ships a shared fixture** (`fixtures/control/`,
   `fixtures/console/`, `fixtures/storage/`) exercised by each runtime's
   fixture-driven tests in the same change. The fixture is the contract;
   the per-runtime types are projections of it.

Senders may lag decoders. Decode tolerance for `console`/`storage` shipped
on all four runtimes; only iOS sends today. That is a feature gap tracked in
SPEC §5, not a contract violation.

## Consequences

- Old payloads decode forever; new payloads degrade gracefully on old
  readers (one cookie instead of two, an ignored frame) rather than failing.
- The folded representative value is a permanent redundancy — writers fill
  two fields, and redaction/scrubbing must cover both. This bit once
  already: the scrub paths blanked the folded value while spreading the
  array through untouched. The rule generalizes: **any transform that
  rewrites a field must rewrite its widened sibling in the same function.**
- Platform constraints live at the edge, not in the contract:
  `HTTPURLResponse` cannot represent repeated header names, so iOS
  comma-joins `headerValues` at apply time — verified safe for cookie
  parsing and documented at the call site. The wire stays lossless.
- Types accrete optional fields instead of staying minimal. Acceptable
  while the pattern stays additive; the day a change cannot be expressed
  additively is the day option B's version field gets revisited.

## Verification plan

- Unknown-kind tolerance tests in `packages/hakka-bridge` and the desktop
  server suite (a fabricated future kind is dropped, not thrown).
- Round-trip regression tests per runtime: two `Set-Cookie` values survive
  capture → promotion → applied mock response.
- Redaction parity tests: scrubbing the folded field also scrubs the
  widened field.
- `fixtures/*` wired into all runtimes' suites; `just verify` runs all of
  it.
