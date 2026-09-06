/**
 * Exporters serialize a request snapshot without reading the store (ADR 0009).
 * Factories bind format-specific options; each export returns file content.
 * Wrappers adapt existing generators to this shared interface.
 */

import type { NetworkRequest } from '../model/types'

/**
 * Identity fields a host (a registry, a share-sheet UI, debug tooling) uses
 * to describe an exporter without running it. THIS is the concrete payoff of
 * having a contract at all: a UI iterates the exporter registry and renders
 * "Export as {label}" (writing `{filename}.{fileExtension}` as `{mimeType}`)
 * for every entry, instead of a hardcoded `if (format === 'har') … else if
 * (format === 'postman') …` chain that needs a new branch for every future
 * format.
 */
export interface ExporterIdentity {
  /** Stable, unique, namespaced id (e.g. `'hakka.har'`, `'acme.grpc-web-json'`) so a third-party exporter can coexist with built-ins. */
  readonly id: string
  /** Human-readable name for a share sheet or settings list, e.g. `"HAR (HTTP Archive)"`. */
  readonly label: string
  /** File extension WITHOUT a leading dot — e.g. `'har'`, `'postman_collection.json'`, `'hakka-repro'`. A caller building a filename appends `.${fileExtension}`. */
  readonly fileExtension: string
  /** MIME type of the exported content, e.g. `'application/json'`, `'text/markdown'`. Always one `type/subtype` pair, no parameters. */
  readonly mimeType: string
}

/**
 * An exporter: turns a snapshot of `NetworkRequest`s into one serialized
 * artifact — the `Exporter` axis from ADR 0009.
 *
 * Contract (binding — `exporterConformance.ts`'s harness checks all of this
 * against any implementation):
 *
 * - `export()` must NOT throw for an empty `requests` array; it returns
 *   whatever that format's "nothing captured yet" shell looks like (an empty
 *   HAR log, an empty Postman collection, an evidence bundle with `requests:
 *   []`, …), never rejects.
 * - `export()` must NOT mutate `requests` or any element of it.
 * - `export()`'s output must actually depend on `requests` — a constant
 *   ignoring the argument fails conformance (checked by feeding two
 *   structurally different inputs and requiring different output).
 * - `includesBodies` must be honest: when `true`, a captured request's
 *   `requestBody` text — when the request the exporter was given has one —
 *   is recoverable from the output; when `false`, request/response body text
 *   never appears in the output at all. `exporterConformance.ts` proves this
 *   with a marker-bearing fixture request, not just a type check on the flag.
 * - Two `export()` calls are independent — nothing about one call's
 *   `requests` may leak into or affect another call's output (no shared
 *   mutable state keyed only by call order). Contrast `CaptureSource`, which
 *   is a start/stop lifecycle over time; `Exporter` is a pure function per
 *   call, with no lifecycle at all.
 */
export interface Exporter extends ExporterIdentity {
  /**
   * `true` when the output cannot reconstruct every field of the input
   * `NetworkRequest`s it consumed — a different wire schema, a deliberate
   * truncation/budget policy, or a projection that only keeps some fields.
   * Exactly two wrapped exporters are NOT lossy: the repro-bundle exporter
   * (`createReproBundleExporter`, wrapping `buildReproBundle` +
   * `serializeReproBundle`) and the session exporter
   * (`createSessionExporter`, wrapping `serializeSession` +
   * `deserializeSession`) — both store `requests` verbatim in their JSON
   * shell and read them back byte-for-byte unchanged. Every other wrapped
   * exporter — even the evidence bundle, which is close to verbatim below
   * its byte budget — declares `lossy: true`, because losslessness that only
   * holds "as long as the input is small enough" is not a guarantee worth
   * making.
   */
  readonly lossy: boolean
  /**
   * `true` when the output MAY contain request or response body text.
   * `false` so a redaction-conscious caller can skip this exporter entirely
   * when it must guarantee no body text leaves the process. There is no
   * in-flight redaction hook on this contract — redaction happens upstream
   * at capture time (see `agentContext.ts`'s docblock) — so a caller who
   * wants a body-bearing exporter WITH redaction must redact the
   * `NetworkRequest`s before calling `export()`, not after.
   */
  readonly includesBodies: boolean
  /**
   * `true` when `export()` can emit content progressively instead of
   * building the whole string before returning. Declared for forward
   * compatibility — every exporter wrapped onto this contract today is
   * all-at-once (`streaming: false`); nothing in the current inventory needs
   * `true` yet, but a future exporter over a very large session might.
   */
  readonly streaming: boolean
  /**
   * Serialize `requests` into this exporter's format. May be sync or async
   * — callers should always `await` the result even when they know a given
   * exporter happens to resolve synchronously today. Never mutates
   * `requests`; never throws for an empty array.
   */
  export(requests: readonly NetworkRequest[]): string | Promise<string>
}
