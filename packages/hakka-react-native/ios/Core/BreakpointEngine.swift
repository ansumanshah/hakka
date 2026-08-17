// @generated — do not edit. Synced from ios/Sources/Common/BreakpointEngine.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

// MARK: - BreakpointPhase

/// Which phase a breakpoint pauses on: before the request is sent (`request`),
/// after the real response returns but before the caller receives it (`response`),
/// or `both` (pauses at either phase).
public enum BreakpointPhase: String, Sendable, Codable, CaseIterable {
    case request
    case response
    case both
}

// MARK: - Breakpoint

/// A breakpoint rule that can pause matching requests at a given phase.
public struct Breakpoint: Sendable, Identifiable {
    /// Stable unique ID.
    public let id: String
    /// Substring matched against the request URL.
    public let pattern: String
    /// Optional HTTP method filter (case-insensitive). `nil` = any method.
    public let method: String?
    /// Phase at which to pause. Default: `.request`.
    public let on: BreakpointPhase
    /// Whether the rule is active.
    public var enabled: Bool
}

// MARK: - BreakpointInput

/// Input for adding a new breakpoint (without `id`).
public struct BreakpointInput: Sendable {
    public let pattern: String
    public let method: String?
    public let on: BreakpointPhase
    public let enabled: Bool
    public let id: String?

    public init(
        pattern: String,
        method: String? = nil,
        on: BreakpointPhase = .request,
        enabled: Bool = true,
        id: String? = nil
    ) {
        self.pattern = pattern
        self.method = method
        self.on = on
        self.enabled = enabled
        self.id = id
    }
}

// MARK: - Paused snapshots

/// The editable request shown while paused at the request phase.
public struct PausedRequest: Sendable {
    public var url: String
    public var method: String
    public var headers: [String: String]
    public var body: String?

    public init(url: String, method: String, headers: [String: String], body: String?) {
        self.url = url
        self.method = method
        self.headers = headers
        self.body = body
    }
}

/// The editable response shown while paused at the response phase.
public struct PausedResponse: Sendable {
    public var status: Int
    public var headers: [String: String]
    /// Body as text — already read from the real response before pausing.
    public var body: String

    public init(status: Int, headers: [String: String], body: String) {
        self.status = status
        self.headers = headers
        self.body = body
    }
}

// MARK: - PausedEntry

/// A held entry discriminated by phase.
public enum PausedEntry: Sendable, Identifiable {
    case request(id: String, requestId: String, request: PausedRequest)
    case response(id: String, requestId: String, response: PausedResponse)

    public var id: String {
        switch self {
        case .request(let id, _, _): return id
        case .response(let id, _, _): return id
        }
    }

    public var requestId: String {
        switch self {
        case .request(_, let rid, _): return rid
        case .response(_, let rid, _): return rid
        }
    }

    public var phase: BreakpointPhase {
        switch self {
        case .request: return .request
        case .response: return .response
        }
    }
}

// MARK: - Resume actions

/// What the user did with a request-phase pause.
public enum ResumeRequestAction: Sendable {
    case resume(edits: PausedRequest?)
    case abort
}

/// What the user did with a response-phase pause.
public enum ResumeResponseAction: Sendable {
    case resume(edits: PausedResponse?)
    case abort
}

// MARK: - BreakpointEngine

/// Thread-safe engine that manages breakpoint rules and paused requests.
///
/// ## Lifecycle
///
/// 1. `HakkaURLProtocol.startLoading` calls `matchesRequest(url:method:)` before issuing
///    the network task. When `true`, it calls `pauseRequest(_:requestId:request:)` which
///    blocks a background queue thread via `DispatchSemaphore` (never the main thread)
///    until the user acts.
///
/// 2. On response arrival, `HakkaURLProtocol` calls `matchesResponse(url:method:)` before
///    delivering bytes to the client. When `true`, it calls `pauseResponse(_:requestId:response:)`
///    similarly, then applies any edits.
///
/// 3. The UI (BreakpointsView) reads `getPaused()` and calls `resume(_:edits:)` or
///    `abort(_:)` — these signal the semaphore and deliver the user's edits back
///    to the waiting network thread.
///
/// Off by default: with no enabled rules, `matchesRequest` / `matchesResponse` return
/// `false` immediately — zero overhead on the hot path.
public final class BreakpointEngine: @unchecked Sendable {

    /// Shared singleton used by `HakkaURLProtocol`.
    public static let shared = BreakpointEngine()

    // MARK: - Private state

    private let lock = NSLock()
    private var rules: [Breakpoint] = []
    private var ruleCounter = 0

    // Pending paused request entries: pauseId → holder
    private var pendingRequests: [String: RequestHolder] = [:]
    // Pending paused response entries: pauseId → holder
    private var pendingResponses: [String: ResponseHolder] = [:]
    private var pauseCounter = 0

    // Change listeners (UI subscribers) keyed by a UUID token for safe removal.
    private var listeners: [String: () -> Void] = [:]

    public init() {}

    // MARK: - Rule management

    /// Add a breakpoint. Returns the generated ID.
    @discardableResult
    public func addBreakpoint(_ input: BreakpointInput) -> String {
        lock.lock()
        defer { lock.unlock() }
        let id = input.id ?? { ruleCounter += 1; return "bp_\(ruleCounter)" }()
        // Replace if ID already exists
        rules.removeAll { $0.id == id }
        rules.append(Breakpoint(
            id: id,
            pattern: input.pattern,
            method: input.method,
            on: input.on,
            enabled: input.enabled
        ))
        notifyLocked()
        return id
    }

    /// Remove a breakpoint by ID.
    public func removeBreakpoint(id: String) {
        lock.lock()
        defer { lock.unlock() }
        rules.removeAll { $0.id == id }
        notifyLocked()
    }

    /// Enable or disable a breakpoint.
    public func setEnabled(id: String, enabled: Bool) {
        lock.lock()
        defer { lock.unlock() }
        if let idx = rules.firstIndex(where: { $0.id == id }) {
            rules[idx].enabled = enabled
        }
        notifyLocked()
    }

    /// Snapshot of all breakpoints.
    public func getBreakpoints() -> [Breakpoint] {
        lock.lock()
        defer { lock.unlock() }
        return rules
    }

    /// Remove all breakpoints.
    public func clearBreakpoints() {
        lock.lock()
        defer { lock.unlock() }
        rules.removeAll()
        ruleCounter = 0
        notifyLocked()
    }

    // MARK: - Matching

    /// Returns `true` if an enabled breakpoint matches this request at the request phase.
    ///
    /// Called from `HakkaURLProtocol.startLoading` — must be fast; no blocking.
    public func matchesRequest(url: String, method: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return matchesLocked(url: url, method: method, phase: .request)
    }

    /// Returns `true` if an enabled breakpoint matches this request at the response phase.
    public func matchesResponse(url: String, method: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return matchesLocked(url: url, method: method, phase: .response)
    }

    private func matchesLocked(url: String, method: String, phase: BreakpointPhase) -> Bool {
        let m = method.uppercased()
        return rules.contains { rule in
            guard rule.enabled else { return false }
            guard rule.on == phase || rule.on == .both else { return false }
            if let ruleMethod = rule.method, ruleMethod.uppercased() != m { return false }
            return url.contains(rule.pattern)
        }
    }

    // MARK: - Pausing — Request phase

    /// Pause a request before it's sent. **Blocks the calling thread** on a background
    /// queue semaphore until the user resumes or aborts. Never call from the main thread.
    ///
    /// - Returns: `.resume(edits:)` — apply edits and forward; `.abort` — fail the request.
    public func pauseRequest(url: String, method: String, requestId: String, request: PausedRequest) -> ResumeRequestAction {
        let pauseId: String
        let holder = RequestHolder(requestId: requestId, request: request)

        lock.lock()
        pauseCounter += 1
        pauseId = "pause_\(pauseCounter)"
        pendingRequests[pauseId] = holder
        notifyLocked()
        lock.unlock()

        holder.semaphore.wait()

        lock.lock()
        pendingRequests.removeValue(forKey: pauseId)
        let action = holder.action
        notifyLocked()
        lock.unlock()

        return action
    }

    // MARK: - Pausing — Response phase

    /// Pause after the real response returned, before delivery to the caller.
    /// **Blocks the calling thread** on a background queue semaphore.
    ///
    /// - Returns: `.resume(edits:)` — deliver (possibly edited) response; `.abort` — fail.
    public func pauseResponse(url: String, method: String, requestId: String, response: PausedResponse) -> ResumeResponseAction {
        let pauseId: String
        let holder = ResponseHolder(requestId: requestId, response: response)

        lock.lock()
        pauseCounter += 1
        pauseId = "pause_\(pauseCounter)"
        pendingResponses[pauseId] = holder
        notifyLocked()
        lock.unlock()

        holder.semaphore.wait()

        lock.lock()
        pendingResponses.removeValue(forKey: pauseId)
        let action = holder.action
        notifyLocked()
        lock.unlock()

        return action
    }

    // MARK: - UI control

    /// Resume a paused request or response, optionally applying edits.
    ///
    /// For a request-phase pause, `edits` should be a `PausedRequest`.
    /// For a response-phase pause, `edits` should be a `PausedResponse`.
    public func resume(pauseId: String, requestEdits: PausedRequest? = nil) {
        lock.lock()
        if let holder = pendingRequests[pauseId] {
            holder.action = .resume(edits: requestEdits)
            holder.semaphore.signal()
            lock.unlock()
            return
        }
        lock.unlock()
    }

    public func resumeResponse(pauseId: String, responseEdits: PausedResponse? = nil) {
        lock.lock()
        if let holder = pendingResponses[pauseId] {
            holder.action = .resume(edits: responseEdits)
            holder.semaphore.signal()
            lock.unlock()
            return
        }
        lock.unlock()
    }

    public func abort(pauseId: String) {
        lock.lock()
        if let holder = pendingRequests[pauseId] {
            holder.action = .abort
            holder.semaphore.signal()
            lock.unlock()
            return
        }
        if let holder = pendingResponses[pauseId] {
            holder.action = .abort
            holder.semaphore.signal()
            lock.unlock()
            return
        }
        lock.unlock()
    }

    /// Resume all paused entries (used on teardown).
    public func resumeAll() {
        lock.lock()
        let reqHolders = Array(pendingRequests.values)
        let resHolders = Array(pendingResponses.values)
        pendingRequests.removeAll()
        pendingResponses.removeAll()
        lock.unlock()

        for h in reqHolders {
            h.action = .resume(edits: nil)
            h.semaphore.signal()
        }
        for h in resHolders {
            h.action = .resume(edits: nil)
            h.semaphore.signal()
        }
        notifyAsync()
    }

    // MARK: - Observation

    /// Returns all currently-paused entries for the UI.
    public func getPaused() -> [PausedEntry] {
        lock.lock()
        defer { lock.unlock() }
        var out: [PausedEntry] = []
        for (pid, h) in pendingRequests {
            out.append(.request(id: pid, requestId: h.requestId, request: h.request))
        }
        for (pid, h) in pendingResponses {
            out.append(.response(id: pid, requestId: h.requestId, response: h.response))
        }
        return out
    }

    public func hasPaused() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return !pendingRequests.isEmpty || !pendingResponses.isEmpty
    }

    /// Subscribe to state changes. Returns an unsubscribe closure.
    public func subscribe(_ listener: @escaping () -> Void) -> () -> Void {
        lock.lock()
        defer { lock.unlock() }
        let token = UUID().uuidString
        listeners[token] = listener
        return { [weak self] in
            self?.lock.lock()
            self?.listeners.removeValue(forKey: token)
            self?.lock.unlock()
        }
    }

    // MARK: - Private helpers

    // Called with lock held.
    private func notifyLocked() {
        let snapshot = Array(listeners.values)
        DispatchQueue.main.async {
            for l in snapshot { l() }
        }
    }

    private func notifyAsync() {
        lock.lock()
        let snapshot = Array(listeners.values)
        lock.unlock()
        DispatchQueue.main.async {
            for l in snapshot { l() }
        }
    }
}

// MARK: - Internal holders

// Internal reference type: mutates `action` after creation and signals the semaphore.
final class RequestHolder: @unchecked Sendable {
    let semaphore = DispatchSemaphore(value: 0)
    let requestId: String
    let request: PausedRequest
    var action: ResumeRequestAction = .resume(edits: nil)

    init(requestId: String = "", request: PausedRequest = PausedRequest(url: "", method: "GET", headers: [:], body: nil)) {
        self.requestId = requestId
        self.request = request
    }
}

final class ResponseHolder: @unchecked Sendable {
    let semaphore = DispatchSemaphore(value: 0)
    let requestId: String
    let response: PausedResponse
    var action: ResumeResponseAction = .resume(edits: nil)

    init(requestId: String = "", response: PausedResponse = PausedResponse(status: 200, headers: [:], body: "")) {
        self.requestId = requestId
        self.response = response
    }
}
