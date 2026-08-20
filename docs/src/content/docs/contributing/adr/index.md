---
title: Architecture Decision Records
description: The formal ADRs behind Hakka's larger architectural bets — trace correlation, production capture, embeddable components, remote sessions, package consolidation, and the Solid 2.0 runtime.
---

An ADR here records a substantial, load-bearing architecture decision: the
context that forced it, the options weighed, the choice made, and its
consequences. That's a different bar than [Decisions](/contributing/decisions/),
which logs smaller pre-1.0 calls (SDK floors, version pins, docs stack) as
short decision/rationale/trigger entries. An ADR gets a number, a full
context/options/decision/consequences writeup, and a verification plan;
a decisions.md entry gets a paragraph.

**Status reflects the current codebase, not the date the ADR was written.**
Some of these describe features that are fully built and shipping; ADR 0004
describes a design that has not been implemented yet — read its status line
before treating anything in it as current behavior.

**Numbering note:** two ADRs share the number 0003 (`0003-embeddable-components`
and `0003-contracts-first-internals`) — a pre-existing collision from when the
latter was written, not introduced here. Both are listed below by their full
slug; treat the number as non-unique and always link by slug, not by number
alone.

| ADR                                                            | Title                                               | Status                             |
| -------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------- |
| [0001](/contributing/adr/0001-cross-target-trace-correlation/) | Cross-target trace correlation                      | Implemented                        |
| [0002](/contributing/adr/0002-production-capture-cohort/)      | Production capture for a debug cohort               | Implemented                        |
| [0003](/contributing/adr/0003-embeddable-components/)          | Embeddable components (P5 founding ADR)             | Implemented                        |
| [0003](/contributing/adr/0003-contracts-first-internals/)      | Contracts-first internals, plugins on the open axes | Implemented — all three axes       |
| [0004](/contributing/adr/0004-remote-sessions/)                | Remote debug sessions                               | Proposed — not yet built           |
| [0005](/contributing/adr/0005-package-consolidation/)          | Package consolidation and naming                    | Implemented                        |
| [0006](/contributing/adr/0006-capture-source-contract/)        | CaptureSource, the first contract off ADR 0003      | Implemented — contract frozen      |
| [0007](/contributing/adr/0007-solid-2-rc/)                     | Ship on Solid 2.0 at the RC                         | Implemented                        |
| [0008](/contributing/adr/0008-desktop-plugin-products/)        | Hakka for macOS as SPM products, not an app         | In progress                        |
