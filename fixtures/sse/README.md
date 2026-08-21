# SSE Wire Fixtures

Raw `text/event-stream` transcripts pinned in real wire shape. These are
asserted by the LLM/SSE presenters on every platform (TypeScript in
`hakka-browser`, Swift in the iOS SDK) so the surfaces cannot drift apart —
see the no-cross-package-duplicates rule in `AGENTS.md`.

## Rules

- Fixture files are wire transcripts, not demos. Keep them small,
  deterministic, and hand-reviewable.
- Keep the exact field names and chunk sequences each provider actually puts
  on the wire (including the final usage-bearing events — that is the point).
- Do not reformat, pretty-print, or rewrap the JSON payloads; they are
  single-line `data:` lines because that is how the APIs emit them.
- Platform presenter tests should read these files rather than inlining
  expected transcripts in language-local test code.
- Add a new fixture only for a genuinely new wire shape (new provider or new
  event grammar), not for a variant of an existing one.

## Current fixtures

- `openai-chat-chunks.sse` — `chat.completion.chunk` stream: role/content
  deltas, `delta.tool_calls` accumulation split across argument fragments
  (keyed by `index`), a terminal `finish_reason` chunk, the final
  `stream_options.include_usage` usage chunk, and `data: [DONE]`.
- `anthropic-messages.sse` — Messages API event sequence: `message_start`
  (model + input tokens), text `content_block_delta`s, a `tool_use` block
  assembled from `input_json_delta` fragments, `message_delta` carrying the
  final `usage`, and `message_stop`.
- `plain-events.sse` — a plain non-LLM stream: comment line, `retry:`,
  named events with `id:`s, and a multi-line `data:` join.
