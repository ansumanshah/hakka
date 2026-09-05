---
title: 'ADR 0015 - Hakka for macOS is paid, and the source stays MIT'
description: The desktop app becomes a paid product while every line of it remains MIT in a public repo. Why that is coherent rather than contradictory, what it means for the SDKs, and why there is deliberately no DRM.
---

Status: Accepted · Date: 2026-08-29

## Context

Hakka for macOS is built and unreleased: no signed build, no users, no reviews. The studio needs
the desktop app to fund the work. Every comparable tool is already paid: Proxyman sells perpetual
licences alongside a team subscription, Bruno gates the git write path behind a per-seat monthly
plan, HTTP Toolkit ships open source with a paid Pro tier, and Charles and Fiddler have charged for
years. The question was never whether to charge. It was what, exactly, is being sold, given that
all 416 Swift files of the app are already public under MIT.

Two facts constrained the answer.

MIT is irrevocable for code already published. Every commit up to today can be used by anyone who
has it, forever, including commercially. A relicence can only ever bind future commits. At the time
of writing the repository has one author, zero merged pull requests, zero forks and zero stars, so
relicensing would have cost nothing in community terms. That window will not stay open, which is
why the decision was made now rather than later.

A licence check compiled into MIT source in a public repository is theatre. Anyone may legally
delete it and redistribute the result. Any design that depends on such a check being present is
built on an assumption the licence itself denies.

## Decision

The source stays MIT. All of it, including `apps/hakka`. What is sold is the official signed,
notarized, auto-updating build.

A build you make yourself from source is yours under MIT, with no conditions, including at work.
An official release used commercially asks for a paid licence. Personal use, learning and
evaluation of the official builds are free. The seven `hakka-*` npm SDKs are free forever and are
explicitly outside the paid product: they are the distribution engine, and narrowing them would
damage the thing that makes the desktop app worth buying.

Enforcement is the honour system. There is no DRM and there will not be.

## Consequences

The repository needs no licence surgery, no per-directory override, no contributor licence
agreement, and no relicensing commit. `LICENSE` at the root continues to cover everything, which is
also the honest description of the situation rather than a convenient one.

Anyone can build and use Hakka for free by compiling it. That is accepted, not tolerated. It is the
same bargain Yaak makes, and the audience most likely to compile from source is the audience least
likely to have been a paying customer anyway.

Revenue depends on the official build being genuinely more convenient than compiling: signed,
notarized, updating through Sparkle, and installable in one step. That convenience is the product,
so it has to stay good. Distribution goes through a merchant of record rather than the App Store,
which also rules out App Store licence-key restrictions.

Because there is no technical enforcement, the free and paid split must be decided before the first
release and then held. Moving that boundary afterwards costs more goodwill than setting it slightly
wrong at the start. Insomnia's 2023 account requirement and Postman's 2026 reduction of free team
seats are both cautionary: users react hard to a previously frictionless thing acquiring friction.

Capture and inspection are not gated. They are the product working at all, and a free tier that
cannot inspect traffic is a demo rather than a free tier.

## Alternatives considered

**Relicense `apps/hakka` to a source-available licence going forward.** Stronger legal moat, and
cheap today given zero forks. Rejected because it buys protection against a risk that mostly is not
real for a solo indie tool, while costing the unqualified "it is open source" claim that makes the
project credible. Reconsider if a repackaged commercial fork ever actually appears.

**Move the desktop app to a private repository.** The strongest protection and the cleanest paid
boundary. Rejected because the public app is a large part of what makes Hakka trustworthy to the
developers it targets, and because `apps/hakka` consumes `ios/` by path and exposes SPM products
that other local projects build against.

**Keep everything free and monetise support or hosting.** Rejected: there is no hosted component,
and a solo maintainer selling support does not scale.
