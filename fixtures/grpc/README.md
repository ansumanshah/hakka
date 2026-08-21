# gRPC / gRPC-Web Wire Fixtures

Raw length-prefixed gRPC message frames, pinned in real wire shape:
`[1-byte compression flag][4-byte big-endian length][message bytes]`,
repeated. This is the framing both plain gRPC (over HTTP/2) and gRPC-Web use
for messages; gRPC-Web additionally appends a trailer pseudo-frame (flag bit
`0x80` set) whose payload is `Key: value\r\n`-formatted trailer text rather
than a protobuf message.

Asserted by the desktop app's `GrpcBodyDecoderTests`
(`apps/hakka/Tests/CoreTests`) against `GrpcBodyDecoder`, which reuses
HakkaCommon's `decodeGrpcWeb`/`decodeProtobuf` for the actual wire walk.

## Rules

- Fixture files are wire transcripts, not demos. Keep them small,
  deterministic, and hand-reviewable (regenerate with a short script rather
  than hand-editing bytes).
- Add a new fixture only for a genuinely new wire shape, not a variant of an
  existing one.

## Current fixtures

- `unary-message.bin` — a single uncompressed data frame. Message: field 1
  varint `42`, field 2 string `"hakka"`.
- `streaming-messages.bin` — two uncompressed data frames in one body (what
  a server-streaming call's captured response looks like — multiple
  messages, one `NetworkRequest.responseBody`).
- `compressed-frame.bin` — one frame with the compression flag (`0x01`) set;
  the payload is real gzip bytes of the `unary-message` protobuf, not
  protobuf-shaped bytes — proof that a compressed frame must not be walked
  as protobuf without inflating first.
- `truncated-frame.bin` — a frame header declaring more message bytes than
  are actually present (first 8 of `unary-message.bin`'s 19 bytes). Must
  decode to a partial/empty result, never crash.
- `grpc-web-status-not-found.bin` — one data frame, then a gRPC-Web trailer
  frame carrying `grpc-status: 5` (`NOT_FOUND`) and a percent-encoded
  `grpc-message`. The point: this is what a *failed* gRPC call looks like
  captured over HTTP — the HTTP status is 200, and the real outcome only
  exists in this trailer frame.
- `grpc-web-status-ok.bin` — trailer-only frame, `grpc-status: 0` (`OK`), no
  data frames — the minimal "call succeeded with no response messages" shape.
