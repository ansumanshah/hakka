---
description: Debug a failing or slow request with Hakka, find it, explain it, fix it, verify the fix, then package a repro.
argument-hint: [what's wrong, e.g. "checkout is 500ing"]
---

The Hakka MCP server is connected. It exposes your app's live captured network traffic and 21
tools in four groups:

- **See**: `list_requests`, `get_request`, `search_requests`, `stats`, `clear`, `get_trace`.
- **Diagnose**: `diagnose`, `detect_leaks`.
- **Change** (dev build only, fire-and-forget): `create_mock`, `promote_capture_to_mock`,
  `delete_mock`, `clear_mocks`, `set_breakpoint`, `delete_breakpoint`, `set_throttle`,
  `replay_request`, `verify_fix`.
- **Reproduce** (read-only): `generate_mocks`, `generate_test`, `generate_repro`,
  `export_evidence`.

Debug this against the live traffic: **$ARGUMENTS**

Work the loop:

1. **Find and explain.** Call `diagnose` first (scope it with the query DSL when you can, e.g.
   `url:/checkout`) to surface the failing or slow request and its likely cause. Use
   `search_requests` / `get_request` for detail if needed. If the failure looks like it could be a
   credential or PII going somewhere it shouldn't (a token to a third-party host, a secret in a
   cacheable response), run `detect_leaks` too. Then state, in one or two sentences, what request
   broke, its status or error, and the most likely cause. Stay on the evidence, do not guess past
   it.
2. **Propose a fix, then wait.** Suggest the smallest useful fix: a `create_mock` canned response,
   a `block`, a `redirect`, a `set_breakpoint`, or a `set_throttle`. If the request already
   captured a good response before it started failing, `promote_capture_to_mock` is faster than
   hand-authoring one. Do not apply anything until I say go.
3. **Apply it, then verify it actually worked.** After I confirm, apply the fix, then call
   `verify_fix` (or `replay_request` followed by a check) against the same request. Do not just
   tell me the fix should work; show me the replayed status/body. Tell me exactly what changed and
   how to re-test it yourself.
4. **Package a repro** once the fix is confirmed: call `generate_repro`, write out the
   `.hakka-repro` bundle and the generated regression test, and give me the file paths.
5. **Clean up.** Any mock or breakpoint you installed in step 2 is still active in the running dev
   app. Once the real fix ships (or if I decide not to pursue this further), remove it with
   `delete_mock` / `delete_breakpoint`, or `clear_mocks` for a clean sweep. Do this even if I never
   asked, it is your mess to clean up.

Rules:

- The change tools affect the **dev build only** and are fire-and-forget. A `sent: false` result
  means the bridge was unreachable, check the app is running and connected, do not assume the app
  rejected the command.
- Prefer `diagnose` over paging raw requests.
- Never mock, block, redirect, breakpoint, or throttle in step 3 without my explicit go-ahead.
- `replay_request` and `verify_fix` refuse three kinds of request, each with a distinct `reason`:
  `websocket_not_replayable`, `runtime_not_replayable` (Next.js server/edge captures), and
  `redacted_headers_not_replayable`. The last one fires when a header like `Authorization` was
  redacted at capture time: replaying would send the literal string `[REDACTED]` and fail auth,
  which reads exactly like an unfixed bug. Never diagnose that refusal as a real auth failure.
  If refused, say which reason came back and fall back
  to asking me to reproduce it manually after the fix.
