---
title: 'ADR 0003 — Contracts-first internals, plugins on the open axes'
description: Every new internal feature lands against a public contract; genuinely open-ended axes (capture sources, exporters, rule engines) get formal plugin machinery; the kernel stays small and named.
---

Status: Implemented · Date: 2026-08-15 · First contract: [ADR 0006](/contributing/adr/0006-capture-source-contract/)

> **All three axes shipped (2026-08-17).** Each is a contract whose doc
> comments are the spec, plus a conformance harness a third party runs against
> their own implementation, plus additive wrappers for every existing
> first-party implementation:
>
> - **Capture sources** — `CaptureSource` (ADR 0006), frozen, 8 sources.
> - **Exporters** — `Exporter` + `checkExporterConformance`, 12 wrapped: HAR,
>   OTel JSON, Postman, cURL, session, agent context, agent evidence, evidence
>   bundle, repro bundle, Playwright routes, MSW handlers, test codegen.
> - **Rule engines** — `RuleEngine` + `checkRuleEngineConformance`, wrapping
>   the mock, throttle, and breakpoint engines. Condition 1's no-per-record-
>   dynamic-dispatch rule is honored by construction: the fetch/XHR
>   interceptors keep calling the concrete engines directly, and the wrappers
>   exist for registration, introspection, and third-party engines.
>
> Two lessons the axes taught, now part of how a contract lands here: a
> contract that wraps only a sample of its implementations is dead weight
> (the exporter axis initially skipped four existing writers), and a harness
> must not claim to check more than it does (the same axis advertised
> mutation and cross-call-independence checks it had not implemented). Both
> were caught in adversarial review and fixed before landing.

## Context

Three features landed in one week — framework-span capture (an OTel
SpanProcessor feeding the bridge), evidence bundles, and MCP replay tooling —
and each was, structurally, "a new source or consumer bolted onto the store."
Each paid an ad-hoc integration cost the previous one had already paid:
finding the ingest path, threading correlation, teaching exporters to
tolerate the new record kind, keeping `hakka-node/prod`'s import graph
clean. Meanwhile the public `StoreClient` interface broke an external
embedder (rozenite) the first time an internal feature added a required
method — proof that internal code is NOT currently held to the public
contract it ships.

The trigger for writing this down: the observation that Hakka's roadmap
(WebTransport, gRPC-web, Server Actions capture, Bun/Deno runtimes, CDP,
native platforms) is dominated by exactly one shape of work — new capture
sources — plus a design-philosophy decision that internal functionality
should consume the same surfaces third parties do.

## Decision

1. **Everything on contracts.** New internal features land against a public,
   exported contract (interface + doc + test harness), never against another
   module's internals. Optionality is part of the contract: adding a member
   to an implemented-by-others interface must be optional with a fail-open
   consumer (the `subscribeSpans` lesson).
2. **Plugins only on the open axes.** Formal, dynamic plugin machinery
   (registration, lifecycle, isolation) exists for exactly three axes, where
   third-party variance is real:
   - **Capture sources** — `CaptureSource` contract: start/stop, emits
     records/spans into the store, declares its runtime + correlation
     behavior. fetch/XHR/WS/ResourceTiming/http/undici/OTel-spans/CDP all
     become sources; the next five get cheap.
   - **Exporters** — one contract over HAR/OTel/Postman/evidence-bundle;
     an exporter never reaches into the store, it receives a snapshot.
   - **Rule engines** — mock/breakpoint/throttle behind one interception
     contract (they already share the control-frame path).
3. **The kernel is small and proud of it.** Store + query, trace
   correlation, the bridge wire protocol, design tokens, and the panel
   _shell_ are kernel. They are versioned, benched, and NOT extensible.
   Panels stay a **curated** internal registry (`panelRegistry.ts`) — the
   5-tab order is design law, not a slot machine.
4. **Migration is opportunistic, not a rewrite.** New code must comply;
   existing code is extracted to contracts only when touched for another
   reason. No big-bang refactor exists on any roadmap.

## Conditions (the quality gate this rides on)

Accepted explicitly on the condition that the detour never ships worse code:

- **Performance budgets are regression gates**: `hakka-core/bench` numbers
  must not regress when a path moves behind a contract; hot paths
  (record ingest, interceptors) may not gain per-record dynamic dispatch —
  sources register once, the store's inner loop stays monomorphic.
- **Contract = tests + docs or it doesn't merge**: every contract ships a
  conformance test harness a third party could run against their impl.
- **No duplication**: knip + the reuse-ledger review discipline apply;
  a contract that mirrors an existing util's shape must absorb it.
- **Adversarial review before any contract stabilizes** (standing library
  rule), and a contract is frozen only after its third real consumer
  (rule of three) — before that it is explicitly `@experimental`.

## Consequences

- The extension story becomes demonstrable pre-launch ("the span capture
  IS a plugin") without betting the launch on a plugin-system rewrite.
- Public API surface grows; each contract is a forever-commitment — hence
  the rule-of-three freeze and `@experimental` staging.
- Some indirection cost is accepted at wiring time (source registration),
  none on hot paths (budget-enforced).
- Post-launch, community demand decides which contracts get external
  registration points; the axes are ready either way.

## Alternatives considered

- **Full microkernel ("everything is a plugin")** — rejected: hides the
  kernel from design scrutiny, taxes every feature with API design before
  its shape is known, and risks the Eclipse/OSGi indirection spiral.
- **Status quo (conventions, no contracts)** — rejected: the rozenite
  breakage shows conventions don't hold under multi-agent development
  velocity; boundaries must be load-bearing to survive.
