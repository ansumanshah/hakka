import Foundation
import HakkaCommon

/// Resolve, send, assert, capture — the core of any API client. An actor
/// because the injected `RequestTransport` may hold connection state across
/// calls; serializing through the actor keeps concurrent `run` calls safe
/// without pushing thread-safety requirements onto every transport.
///
/// Cookies: the runner owns cookie persistence through `cookies` — response
/// `Set-Cookie` headers land in the jar and later sends carry the jar's
/// cookies as a `Cookie` header. Doing it here rather than in `URLSession`
/// keeps the behavior identical for every transport (including test stubs)
/// and lets a future Cookies tab read the same jar the sends use.
public actor RequestRunner {
    // Not `private`: `RequestRunner+Send.swift` (same module, different
    // file) needs these, and `private` is file-scoped in Swift.
    let transport: RequestTransport
    let cookies: CookieStoring
    let defaultTimeout: TimeInterval
    /// Runs pre-request/post-response scripts — see `RequestScriptHooks`
    /// for the abort-vs-proceed and state-sharing rules. Injectable for
    /// tests the same way `transport` is; defaults to the real
    /// JavaScriptCore implementation.
    let scriptRuntime: ScriptRuntime

    /// `transport` defaults to nil so the default send path and the default
    /// jar can share one cookie identity: the fallback `URLSessionTransport`
    /// binds its session configuration to the jar's backing storage.
    public init(
        transport: RequestTransport? = nil,
        defaultTimeout: TimeInterval = 30,
        cookies: CookieStoring = CookieJar(),
        scriptRuntime: ScriptRuntime = JavaScriptCoreScriptRuntime(),
    ) {
        self.cookies = cookies
        self.transport = transport ?? URLSessionTransport(cookies: cookies)
        self.defaultTimeout = defaultTimeout
        self.scriptRuntime = scriptRuntime
    }

    /// Resolves `request` against `collection`/`folderChain`/`scope`, sends
    /// it, then evaluates assertions and captures against the response.
    ///
    /// Throws only for failures *before* a `URLRequest` could be built
    /// (missing variables, a bad URL, an unencodable body) — a network
    /// failure after that point is recorded as `record.error` in the
    /// returned `RunResult`, the same way a failed capture in live traffic
    /// is a record with an error, not a crash.
    public func run(
        _ request: RequestSpec,
        folderChain: [Folder] = [],
        collection: Collection,
        scope: VariableScope,
    ) async throws(RequestRunnerError) -> RunResult {
        let (effectiveRequest, scopeAfterPreRequest) = try await applyPreRequestScript(request, scope: scope)
        let resolved = try resolvePlan(
            effectiveRequest, folderChain: folderChain, collection: collection, scope: scopeAfterPreRequest,
        )
        let encodedBody = try encodeBody(resolved.body)

        var headers = resolved.headers
        // `resolved.headers` already carries a Content-Type set by the user or
        // implied by the body (case-insensitively deduped in `RequestResolver`)
        // for every body type except multipart, whose boundary is only known
        // now. Check case-insensitively before adding — `resolved.headers` is a
        // plain `[String: String]`, so writing the literal key "Content-Type"
        // unconditionally would coexist with a differently-cased header instead
        // of honoring it, sending two Content-Type headers on the wire.
        let hasContentTypeHeader = headers.keys.contains { $0.caseInsensitiveCompare("Content-Type") == .orderedSame }
        if !hasContentTypeHeader, let contentType = encodedBody.contentType {
            headers["Content-Type"] = contentType
        }

        var urlRequest = URLRequest(url: resolved.url)
        urlRequest.httpMethod = resolved.method.rawValue
        urlRequest.timeoutInterval = resolved.timeout ?? defaultTimeout
        urlRequest.allHTTPHeaderFields = headers
        urlRequest.httpBody = encodedBody.data

        // The jar's cookies ride as a real Cookie header on the wire and in
        // the record. `CookieWire.attachCookies` leaves a user-set Cookie
        // header (typed or imported from `curl -b`) untouched, so mirroring
        // the attached value back into `headers` only adds what the jar
        // actually contributed — never a duplicate of an explicit header.
        urlRequest = CookieWire.attachCookies(cookies.cookies(for: resolved.url), to: urlRequest)
        let hasCookieHeader = headers.keys.contains { $0.caseInsensitiveCompare("Cookie") == .orderedSame }
        if hasCookieHeader == false, let attachedCookieHeader = urlRequest.value(forHTTPHeaderField: "Cookie") {
            headers["Cookie"] = attachedCookieHeader
        }

        let startedAt = Date()
        let record = await sendAndBuildRecord(
            urlRequest,
            followRedirects: resolved.followRedirects,
            requestHeaders: headers,
            requestBody: encodedBody.data,
            method: resolved.method,
            url: resolved.url,
            startedAt: startedAt,
        )

        let assertionResults = request.assertions.map { AssertionEvaluator.evaluate($0, against: record) }
        var updatedScope = scopeAfterPreRequest
        ResponseCaptureExtractor.apply(request.captures, record: record, into: &updatedScope)

        let (finalScope, scriptError) = await RequestScriptHooks.runPostResponse(
            for: request,
            record: record,
            scope: updatedScope,
            runtime: scriptRuntime,
        )

        return RunResult(record: record, assertionResults: assertionResults, scope: finalScope, scriptError: scriptError)
    }

    /// Runs `request`'s pre-request script (if any) before resolution ever
    /// sees the request — see `RequestScriptHooks`. A throw here means the
    /// script failed; the run stops with `RequestRunnerError.script`
    /// instead of falling through to send `request` unmodified.
    private func applyPreRequestScript(
        _ request: RequestSpec,
        scope: VariableScope,
    ) async throws(RequestRunnerError) -> (request: RequestSpec, scope: VariableScope) {
        do {
            return try await RequestScriptHooks.applyPreRequest(to: request, scope: scope, runtime: scriptRuntime)
        } catch let error as ScriptError {
            throw .script(error)
        } catch {
            throw .script(.runtimeError(String(describing: error)))
        }
    }

    private func resolvePlan(
        _ request: RequestSpec,
        folderChain: [Folder],
        collection: Collection,
        scope: VariableScope,
    ) throws(RequestRunnerError) -> ResolvedRequest {
        do {
            return try RequestResolver.resolve(request, folderChain: folderChain, collection: collection, scope: scope)
        } catch {
            throw .resolution(error)
        }
    }

    private func encodeBody(_ body: BodySpec) throws(RequestRunnerError) -> EncodedBody {
        do {
            return try RequestBodyEncoder.encode(body)
        } catch {
            throw .bodyEncoding(error)
        }
    }

}
