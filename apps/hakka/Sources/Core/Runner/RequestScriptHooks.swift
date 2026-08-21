import Foundation
import HakkaCommon

/// Wires `ScriptRuntime` into a request's lifecycle (ADR 0010 phase 4.2): a
/// pre-request hook that can mutate the outgoing request before
/// `RequestResolver` ever sees it, and a post-response hook that can read
/// the response and hand values forward through the environment. Kept out
/// of `RequestRunner` itself so that file stays focused and this stays
/// independently testable.
///
/// **Abort, not proceed, on a pre-request script failure.** A script that
/// was supposed to sign or transform a request and threw instead must not
/// let an unsigned/untransformed request go out looking like it succeeded —
/// `RequestRunner.run` throws `RequestRunnerError.script` before a
/// `URLRequest` is ever built, the same "refuse before send" shape as a
/// resolution or body-encoding failure.
///
/// **A post-response script failure is different.** The response already
/// happened and is already a real, useful record — discarding it because a
/// *script* threw afterward would hide a legitimate result behind an
/// unrelated bug. So a post-response failure is reported through
/// `RunResult.scriptError` instead of thrown: visible, but not destructive.
///
/// **Nothing is shared between scripts in a folder run.** Each call here is
/// a fresh `ScriptRuntime.run`, and the contract guarantees a fresh,
/// isolated `JSContext` per call (see `ScriptRuntime`) — a script cannot
/// see a global another script set. The *only* channel between requests in
/// a chain is the same one `ResponseCapture` already uses:
/// `VariableScope.runtime`, which `vars.set(...)` writes into exactly like
/// a capture does, so the next request's `{{variable}}` interpolation can't
/// tell the two apart.
enum RequestScriptHooks {
    /// Runs `request.scripts.preRequestLines` (if any) and returns a
    /// request with its mutations applied, still unresolved —
    /// `RequestResolver` runs on the result exactly as it would on
    /// `request` itself, so any `{{variable}}` the user typed (untouched by
    /// the script) still resolves normally afterward.
    static func applyPreRequest(
        to request: RequestSpec,
        scope: VariableScope,
        runtime: ScriptRuntime,
    ) async throws -> RequestSpec {
        guard let scripts = request.scripts, !scripts.preRequestLines.isEmpty else { return request }

        let output = try await runtime.run(ScriptInput(
            source: scripts.preRequestSource,
            env: scope.flattened,
            request: requestContext(for: request),
        ))
        guard let mutated = output.request else { return request }
        return applying(mutated, to: request)
    }

    /// Runs `request.scripts.postResponseLines` (if any) against `record`.
    /// Returns `scope` with any `vars.set(...)` values folded into
    /// `runtime`, plus a human-readable failure description when the
    /// script itself failed (`scope` is returned unchanged in that case).
    static func runPostResponse(
        for request: RequestSpec,
        record: NetworkRequest,
        scope: VariableScope,
        runtime: ScriptRuntime,
    ) async -> (scope: VariableScope, error: String?) {
        guard let scripts = request.scripts, !scripts.postResponseLines.isEmpty else { return (scope, nil) }

        do {
            let output = try await runtime.run(ScriptInput(
                source: scripts.postResponseSource,
                env: scope.flattened,
                response: responseContext(for: record),
            ))
            var updated = scope
            for (key, value) in output.variables { updated.setRuntime(key, value) }
            return (updated, nil)
        } catch let error as ScriptError {
            return (scope, describe(error))
        } catch {
            return (scope, String(describing: error))
        }
    }

    // MARK: - Context bridging

    private static func requestContext(for request: RequestSpec) -> ScriptRequestContext {
        ScriptRequestContext(
            method: request.method.rawValue,
            url: request.url,
            headers: Dictionary(
                request.headers.filter(\.enabled).map { ($0.name, $0.value) },
                uniquingKeysWith: { _, last in last },
            ),
            body: rawBodyText(request.body),
        )
    }

    private static func responseContext(for record: NetworkRequest) -> ScriptResponseContext {
        ScriptResponseContext(
            status: record.status ?? 0,
            headers: Dictionary(
                record.responseHeaders.compactMap { name, values in values.first.map { (name, $0) } },
                uniquingKeysWith: { _, last in last },
            ),
            body: record.responseBody,
        )
    }

    private static func rawBodyText(_ body: BodySpec) -> String? {
        guard case let .raw(text, _) = body else { return nil }
        return text
    }

    /// Applies a pre-request script's mutations back onto `request`. Method
    /// and URL and headers always apply; the body only applies when the
    /// original was `.raw` or `.none` — a script has no way to express a
    /// multipart/form/graphql/file body shape through a plain string, so
    /// those are left untouched rather than silently discarding structure
    /// the script never saw in the first place (`rawBodyText` only ever
    /// hands a `.raw` body to the script, so this is the same boundary in
    /// reverse).
    private static func applying(_ mutated: ScriptRequestContext, to request: RequestSpec) -> RequestSpec {
        var updated = request
        updated.method = HttpMethod(rawString: mutated.method)
        updated.url = mutated.url
        updated.headers = mutated.headers.map { HeaderPair(name: $0.key, value: $0.value) }
        if let body = mutated.body {
            switch request.body {
            case let .raw(_, contentType):
                updated.body = .raw(text: body, contentType: contentType)
            case .none:
                updated.body = .raw(text: body, contentType: "text/plain")
            default:
                break
            }
        }
        return updated
    }

    private static func describe(_ error: ScriptError) -> String {
        switch error {
        case .timeout: "post-response script timed out"
        case let .runtimeError(message): message
        }
    }
}
