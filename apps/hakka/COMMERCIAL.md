# Commercial use

Hakka for macOS is open source and also a paid product. Those two things are not in tension, and
this page explains exactly where the line sits so you never have to guess.

## The short version

**The source code is MIT.** All of it, including this app. You can read it, fork it, modify it, and
build it yourself. A build you make from source is yours to use however you like, including at work,
including commercially. Nothing in this repository is licensed to you conditionally.

**The official builds are a paid product.** The signed, notarized, auto-updating release of Hakka
for macOS that you download from the website is what a licence pays for. Buying one funds the work;
it does not unlock code you were otherwise forbidden from running.

This is the same shape Yaak uses, and it is deliberate. The SDKs are how Hakka reaches people, so
they stay MIT and always will. The desktop app is the thing worth paying for, so the convenience of
a maintained, notarized, updating binary is what is sold.

## Why it is set up this way

A licence check inside MIT source in a public repository would be theatre. Anyone could delete it
and redistribute the result, entirely legally, and they would be within their rights. Pretending
otherwise would insult the people most likely to read the source in the first place.

So there is no DRM, and there will not be. Licensing here runs on the honour system, which is the
norm across this category of tool. If Hakka saves you time at work, buying a licence is how it keeps
being maintained. If you would rather build it yourself, the instructions are in the README and that
is a legitimate thing to do.

## What this means in practice

| You want to                                                                   | What applies                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Read, fork, or modify the source                                              | MIT. No permission needed, no licence needed.               |
| Build it yourself and use your build                                          | MIT. Including at work.                                     |
| Use an official signed release at work                                        | A paid licence.                                             |
| Use an official signed release for personal projects, learning, or evaluation | Free.                                                       |
| Use the `hakka-*` npm SDKs anywhere                                           | MIT. They are not part of the paid product and will not be. |

## What is not decided yet

Pricing, tiers, and exactly which features sit behind a licence are still open. Nothing is being
taken away from anyone: the app has never shipped, so there is no existing free tier to shrink. The
intent is to decide the line before the first release and then leave it alone, because moving a
free/paid boundary after people depend on it costs far more goodwill than getting it slightly wrong
at the start.

Capture and inspection are the product working at all, so they are not the things that will be
gated.

## Questions

Open an issue, or mail ansumanshah@gmail.com.
