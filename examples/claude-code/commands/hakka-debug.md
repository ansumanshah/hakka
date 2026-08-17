---
description: Debug a failing or slow request with Hakka — find it, explain it, mock a fix, then package a repro.
argument-hint: [what's wrong, e.g. "checkout is 500ing"]
---

The Hakka MCP server is connected. It exposes your app's live captured network traffic
(`diagnose`, `search_requests`, `get_request`, `stats`), tools that change traffic in the
running dev app (`create_mock`, `set_breakpoint`, `set_throttle`), and repro tools
(`generate_repro`, `generate_test`, `generate_mocks`).

Debug this against the live traffic: **$ARGUMENTS**

Work the loop:

1. **Find and explain.** Call `diagnose` first (scope it with the query DSL when you can, e.g.
   `url:/checkout`) to surface the failing or slow request and its likely cause. Use
   `search_requests` / `get_request` for detail if needed. Then state, in one or two sentences,
   what request broke, its status or error, and the most likely cause. Stay on the evidence — do
   not guess past it.
2. **Propose a fix, then wait.** Suggest the smallest useful fix (a `create_mock` canned response,
   a `block`, a `redirect`, or a `set_throttle`). Do not apply it until I say go.
3. **Apply it** only after I confirm, then tell me exactly what changed and how to re-test.
4. **Package a repro** once the fix is confirmed: call `generate_repro`, write out the
   `.hakka-repro` bundle and the generated regression test, and give me the file paths.

Rules:

- The change tools affect the **dev build only** and are fire-and-forget. A `sent: false` result
  means the bridge was unreachable — check the app is running and connected, do not assume the
  app rejected the command.
- Prefer `diagnose` over paging raw requests.
- Never mock, block, redirect, or throttle in step 3 without my explicit go-ahead.
