# Runtime control v1

These additive frames coexist with the original `request`, `span`, `console`, `storage`, and `control` frames. Runtime/control parsers must ignore unknown frames safely. No record-schema version changes.

A socket starts as legacy (unknown runtime, empty capabilities, unacknowledged). A runtime sends `runtime.hello` with protocolVersion 1 and only command kinds it can actually apply; controllers announce role `controller` and empty capabilities. The hub assigns a fresh per-connection target ID and sends `runtime.welcome`. It publishes `runtime.targets` snapshots to controllers on joins, hello updates, and departures. Controller sockets are excluded from targets. IDs never identify a reconnect as its old connection.

Controllers send `control.request` with unique commandId, explicit targetId, a validated host-to-device command, and timeoutMs (1–30000). The hub forwards only to that target after capability validation; targeted frames must never be converted to legacy broadcast. Only a result from the selected socket for a pending command can complete it. Unknown, late, duplicate, or wrong-peer results are ignored. Disconnect and timeout fail pending requests. Legacy targets remain readable but reject acknowledged mutations explicitly.

A runtime validates targetId against its welcome, capability against its advertised list, and command shape. It replies `applied` only after its local engine has applied the command, otherwise `failed` with a stable error code; no captured bodies, credentials or exception messages in results. Duplicate command IDs must not reapply a mutation. Bounded caches may forget old IDs after a connection ends; the hub rejects retries of completed IDs on that connection. Native iOS/Android currently omit request.replay and storage.set because their common engine appliers do not implement them.

MCP selection requires targetId whenever several runtime peers exist, even if only one supports the requested operation. Missing capability, legacy, disconnect and timeout are explicit failures. verify_fix must await mock apply acknowledgment before replaying; a timeout must not authorize replay. Legacy read tools keep working.
