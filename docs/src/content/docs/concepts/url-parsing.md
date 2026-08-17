---
title: URL parsing for display
description: Why Hakka hand-rolls URL parsing instead of using the ambient URL constructor.
---

`urlParser.ts`'s `parseUrl` is hand-rolled on purpose — it must never be replaced with
the ambient `URL` constructor.

## Why

React Native's `URL` (`react-native/Libraries/Blob/URL.js`) is a regex stub, not a
WHATWG parser. Its `host` getter is `/^https?:\/\/(?:[^@]+@)?([^:/?#]+)/` — an
unbounded, greedy "userinfo" group that swallows everything up to the **last** `@`
anywhere in the string, including `@` characters inside the path.

Any URL with a scoped package or a bun-store segment in it — every Metro asset URL in
dev, e.g. `http://localhost:8081/assets/../node_modules/.bun/react-native@0.85.3+13717e69d21c358c/...`
— therefore reported its host as `0.85.3+13717e69d21c358c:8081` in the inspector, and
painted it chili-red as an insecure origin. (An earlier version of this codebase
misdiagnosed those entries as "a bare versioned build identifier wearing a scheme it
was never meant to have" — they were nothing of the sort; this RN `URL` bug was the
actual cause.)

Parsing here instead of delegating also means web, Node, and React Native render the
exact same host and path for the same request, which is the point of a cross-platform
inspector.

## Deliberate difference from WHATWG

Dot segments are **not** collapsed, so the path shown is the path the client actually
put on the wire.

## Call sites

`domainUtils.ts`'s `extractHost`/`extractHttpHost` and every other host/path display in
the inspector go through `parseUrl` for this reason — never the ambient `URL`.
