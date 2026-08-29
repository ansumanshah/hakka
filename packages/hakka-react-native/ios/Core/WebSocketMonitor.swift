// @generated — do not edit. Synced from ios/Sources/Network/WebSocketMonitor.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation
#if canImport(HakkaCommon)
import HakkaCommon
#endif

// MARK: - Constants

/// Binary frames larger than this threshold are stored as a byte count only.
/// Not `private` so `buildWsMessage`'s cap boundary is directly testable.
let wsBinaryCap = 32 * 1024  // 32KB

/// Per-connection cap on retained frames in `HakkaWSTracker.frames` — past
/// this, the oldest frame is dropped on every new append rather than growing
/// without bound. `frames` is only drained on `flush()` (at connection
/// close), so a long-lived, high-traffic socket (chat, a live feed, or
/// Hakka's own bridge connection, which is expected to stay open for the
/// whole dev session) would otherwise retain every frame's payload in memory
/// for the life of the connection. Matches Android's
/// `HakkaWebSocketWrapper.MAX_FRAMES` exactly so both platforms bound WS
/// frame retention the same way. Not `private` so tests can assert against
/// it directly rather than hardcoding the number.
let wsMaxFrames = 2_000

// MARK: - HakkaWebSocketMonitor

/// Intercepts native `URLSessionWebSocketTask` connections and emits a
/// `NetworkRequest` (source: `.nativeWebSocket`) when the connection closes.
/// Every frame (sent + received) is captured into `messages`:
///   - text frames store the payload string
///   - binary frames ≤32KB are base64-encoded; larger frames store the byte count only
/// The negotiated sub-protocol is recorded in `wsProtocol`.
///
/// Outbound frames are captured by swizzling `send`; inbound frames are
/// captured by swizzling `receive` the same way — piggybacking on the app's
/// OWN `receive()` calls rather than issuing an independent one of Hakka's.
/// `URLSessionWebSocketTask` allows only ONE outstanding `receive()` call at
/// a time, so a monitor that called `receive()` itself would compete with,
/// and could silently consume frames meant for, the host app's own receive
/// loop. See `swizzleWebSocketReceive` below for details.
///
/// Requires iOS 13+ (URLSessionWebSocketTask debut).  The class compiles
/// but is a no-op on older OS versions; the `@available` guard ensures
/// no runtime crash on iOS 12.
@available(iOS 13.0, macOS 10.15, *)
public final class HakkaWebSocketMonitor: @unchecked Sendable {

    // MARK: - Public API

    /// Install WS monitoring globally by swizzling URLSession's webSocketTask
    /// factory methods.  Safe to call multiple times — swizzles only once.
    public static func installGlobally(interceptor: HakkaInterceptor) {
        globalInterceptor = interceptor
        swizzleOnce()
    }

    /// Remove the global interceptor reference (does not un-swizzle).
    public static func uninstall() {
        globalInterceptor = nil
    }

    // MARK: - Internals

    nonisolated(unsafe) static weak var globalInterceptor: HakkaInterceptor?

    /// Guards one-time swizzle.
    nonisolated(unsafe) private static var swizzled = false
    private static let swizzleLock = NSLock()

    // MARK: - Swizzle

    private static func swizzleOnce() {
        swizzleLock.lock()
        defer { swizzleLock.unlock() }
        guard !swizzled else { return }
        swizzled = true

        // Swizzle URLSession.webSocketTask(with url:) — URL variant
        let urlSel = #selector(URLSession.webSocketTask(with:) as (URLSession) -> (URL) -> URLSessionWebSocketTask)
        let urlSwizzleSel = #selector(URLSession.hakka_webSocketTask(with:) as (URLSession) -> (URL) -> URLSessionWebSocketTask)
        if let orig = class_getInstanceMethod(URLSession.self, urlSel),
           let swiz = class_getInstanceMethod(URLSession.self, urlSwizzleSel) {
            method_exchangeImplementations(orig, swiz)
        }

        // Swizzle URLSession.webSocketTask(with request:) — URLRequest variant
        let reqSel = #selector(URLSession.webSocketTask(with:) as (URLSession) -> (URLRequest) -> URLSessionWebSocketTask)
        let reqSwizzleSel = #selector(URLSession.hakka_webSocketTask(withRequest:))
        if let orig = class_getInstanceMethod(URLSession.self, reqSel),
           let swiz = class_getInstanceMethod(URLSession.self, reqSwizzleSel) {
            method_exchangeImplementations(orig, swiz)
        }

        // Swizzle URLSessionWebSocketTask.send for outbound frame capture
        swizzleWebSocketSend()
        // Swizzle URLSessionWebSocketTask.receive for inbound frame capture
        swizzleWebSocketReceive()
    }
}

// MARK: - URLSession extension (swizzled methods)

@available(iOS 13.0, macOS 10.15, *)
extension URLSession {
    /// Associated-object key: marks a task already wrapped by Hakka.
    /// `nonisolated(unsafe)` suppresses the Swift Concurrency global-mutable warning;
    /// access is protected by the value itself being used only as an ObjC key address.
    nonisolated(unsafe) private static var hakkaWrappedKey: UInt8 = 0

    @objc func hakka_webSocketTask(with url: URL) -> URLSessionWebSocketTask {
        // Calls the original (names are swapped at runtime)
        let task = self.hakka_webSocketTask(with: url)
        wrapIfNeeded(task, urlString: url.absoluteString)
        return task
    }

    @objc func hakka_webSocketTask(withRequest request: URLRequest) -> URLSessionWebSocketTask {
        let task = self.hakka_webSocketTask(withRequest: request)
        let urlString = request.url?.absoluteString ?? ""
        wrapIfNeeded(task, urlString: urlString)
        return task
    }

    private func wrapIfNeeded(_ task: URLSessionWebSocketTask, urlString: String) {
        guard let interceptor = HakkaWebSocketMonitor.globalInterceptor, interceptor.isRunning else { return }

        // A session that has opted out of custom protocol handling entirely
        // (`protocolClasses` explicitly `[]`, not `nil`) is exactly the
        // self-exclusion `HakkaBridgeClient.openConnection()` sets up for its
        // own HTTP capture, so its WebSocket handshake can never be replayed
        // as a plain HTTP request by `HakkaURLProtocol` (see that method's
        // doc comment in `BridgeClient.swift`). Mirror it here: without this
        // check, Hakka's own outbound connection to the desktop bridge — a
        // `URLSessionWebSocketTask` like any other — gets wrapped and
        // tracked like app traffic, and since that connection is expected to
        // stay open for the whole dev session, every request Hakka streams
        // to the bridge would accumulate as a "frame" on itself. This covers
        // the bridge connection regardless of whether `bridgeURL` was
        // configured explicitly or found via LAN auto-discovery, since both
        // paths build their session the same way.
        if let protocolClasses = self.configuration.protocolClasses, protocolClasses.isEmpty {
            return
        }

        // Host-app-configured ignore list — the same check
        // `HakkaURLProtocol.canInit` applies to HTTP requests — so a
        // WebSocket host can be opted out by URL/host pattern the same way
        // HTTP requests already can be.
        if let url = URL(string: urlString), interceptor.shouldIgnore(url: url) {
            return
        }

        // Prevent double-wrap
        let alreadyWrapped = objc_getAssociatedObject(task, &URLSession.hakkaWrappedKey) as? Bool ?? false
        guard !alreadyWrapped else { return }
        objc_setAssociatedObject(task, &URLSession.hakkaWrappedKey, true, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)

        let startTime = Int64(Date().timeIntervalSince1970 * 1000)
        let taskId = UUID().uuidString
        let tracker = HakkaWSTracker(taskId: taskId, url: urlString, startTime: startTime)
        // Attach tracker to task so it lives as long as the task. Inbound frame
        // capture happens passively from here on — see `swizzleWebSocketReceive`
        // below — Hakka never calls `receive()` on this task itself.
        objc_setAssociatedObject(task, &hakkaWSTrackerKey, tracker, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }
}

// MARK: - URLSessionWebSocketTask send swizzle
//
// URLSessionWebSocketTask.send(_:completionHandler:) takes a Swift enum
// (URLSessionWebSocketTask.Message) which is not ObjC-representable, so
// method_exchangeImplementations on an @objc-annotated Swift method is not
// possible for the Message parameter.
//
// Strategy: use the ObjC IMP-based swizzle via unsafeBitCast so the compiler
// does not see the un-bridgeable enum type.  The actual ABI layout for
// URLSessionWebSocketTask.Message on Darwin ObjC is an NSObject pointer
// (the concrete private class __NSURLSessionWebSocketMessage), so casting
// through UnsafeRawPointer is ABI-safe on the targeted platforms (iOS 13+,
// macOS 10.15+).
//
// The captured IMP (pointer to the original implementation) is stored in a
// file-scope nonisolated(unsafe) variable — identical to how URLSession
// swizzling works throughout this file.

typealias WSSendIMP = @convention(c) (
    AnyObject,          // self (URLSessionWebSocketTask)
    Selector,           // _cmd  (sendMessage:completionHandler:)
    AnyObject,          // message (opaque __NSURLSessionWebSocketMessage)
    AnyObject           // completionHandler (block bridged from Swift closure)
) -> Void

nonisolated(unsafe) private var originalWSSendIMP: WSSendIMP?

@available(iOS 13.0, macOS 10.15, *)
private func swizzleWebSocketSend() {
    let sel = NSSelectorFromString("sendMessage:completionHandler:")
    guard
        let method = class_getInstanceMethod(URLSessionWebSocketTask.self, sel),
        let hookMethod = class_getInstanceMethod(URLSessionWebSocketTask.self,
                                                 #selector(URLSessionWebSocketTask.hakka_sendMessage(_:completionHandler:)))
    else { return }

    originalWSSendIMP = unsafeBitCast(method_getImplementation(method), to: WSSendIMP.self)
    method_exchangeImplementations(method, hookMethod)
}

@available(iOS 13.0, macOS 10.15, *)
extension URLSessionWebSocketTask {
    // This @objc method is the swizzled replacement.  Its selector is
    // `hakka_sendMessage:completionHandler:` — at runtime the implementations
    // are exchanged so this runs when app code calls `send(_:completionHandler:)`.
    //
    // The `completionHandler:` block can't be declared with the typed Swift
    // closure here (ObjC-bridge constraint), so it's accepted as AnyObject (the
    // bridged block). The original IMP is called via the saved function
    // pointer, avoiding re-bridging through Swift's type system.
    @objc func hakka_sendMessage(_ messageObj: AnyObject, completionHandler: AnyObject) {
        if let tracker = objc_getAssociatedObject(self, &hakkaWSTrackerKey) as? HakkaWSTracker {
            // Detect text vs. data frames from the private class name.
            // The underlying concrete type is __NSURLSessionWebSocketMessage.
            // It responds to -type (returns 0=text,1=data) and either -string or -data.
            if let typeVal = (messageObj as? NSObject)?.value(forKey: "type") as? Int {
                if typeVal == 0, let text = (messageObj as? NSObject)?.value(forKey: "string") as? String {
                    tracker.frameSent(message: .string(text))
                } else if typeVal == 1, let data = (messageObj as? NSObject)?.value(forKey: "data") as? Data {
                    tracker.frameSent(message: .data(data))
                }
            }
        }

        if let imp = originalWSSendIMP {
            imp(self, #selector(hakka_sendMessage(_:completionHandler:)), messageObj, completionHandler)
        }
    }
}

// MARK: - URLSessionWebSocketTask receive swizzle
//
// URLSessionWebSocketTask allows only ONE outstanding `receive()` call at a
// time. An earlier version of this monitor drove its own perpetually
// re-arming `task.receive()` loop, independent of and competing with any
// receive loop the host app runs on the same task — since Hakka's loop was
// armed synchronously at task-creation time (inside the swizzled factory
// method, before the app even gets the task back), it typically claimed the
// slot first, meaning inbound frames could be handed to Hakka and never
// reach the app's own `receive()` completion handler at all.
//
// Fix: never call `receive()` independently. Instead, piggyback on the
// app's OWN `receive()` calls, the same way `send` is intercepted above —
// swizzle the ObjC entry point Swift's public `receive(completionHandler:)`
// compiles down to (confirmed against Foundation's NSURLSession.h:
// `- (void)receiveMessageWithCompletionHandler:(void (^)(NSURLSessionWebSocketMessage
// * _Nullable message, NSError * _Nullable error))completionHandler;`) so every
// message the app reads is observed on its way OUT, then forwarded to the
// app's own completion handler unchanged. Hakka never holds the task's one
// outstanding receive slot, so it can never starve or steal a frame meant
// for the app.

typealias WSReceiveIMP = @convention(c) (
    AnyObject,          // self (URLSessionWebSocketTask)
    Selector,           // _cmd  (receiveMessageWithCompletionHandler:)
    AnyObject           // completionHandler (block bridged from Swift closure)
) -> Void

nonisolated(unsafe) private var originalWSReceiveIMP: WSReceiveIMP?

@available(iOS 13.0, macOS 10.15, *)
private func swizzleWebSocketReceive() {
    let sel = NSSelectorFromString("receiveMessageWithCompletionHandler:")
    guard
        let method = class_getInstanceMethod(URLSessionWebSocketTask.self, sel),
        let hookMethod = class_getInstanceMethod(URLSessionWebSocketTask.self,
                                                 #selector(URLSessionWebSocketTask.hakka_receiveMessageWithCompletionHandler(_:)))
    else { return }

    originalWSReceiveIMP = unsafeBitCast(method_getImplementation(method), to: WSReceiveIMP.self)
    method_exchangeImplementations(method, hookMethod)
}

@available(iOS 13.0, macOS 10.15, *)
extension URLSessionWebSocketTask {
    // This @objc method is the swizzled replacement for
    // `receiveMessageWithCompletionHandler:` — at runtime the implementations
    // are exchanged so this runs whenever app code calls `receive(completionHandler:)`.
    // Wraps the app's own completion handler (never calling `receive()` on its
    // own behalf) so Hakka observes each inbound frame on its way back out to
    // the app, then forwards it unchanged.
    @objc func hakka_receiveMessageWithCompletionHandler(_ completionHandler: AnyObject) {
        guard let imp = originalWSReceiveIMP else { return }
        guard let tracker = objc_getAssociatedObject(self, &hakkaWSTrackerKey) as? HakkaWSTracker else {
            imp(self, #selector(hakka_receiveMessageWithCompletionHandler(_:)), completionHandler)
            return
        }

        let originalHandler = unsafeBitCast(
            completionHandler,
            to: (@convention(block) (NSObject?, NSError?) -> Void).self
        )
        let wrapped: @convention(block) (NSObject?, NSError?) -> Void = { [weak self] messageObj, error in
            if let messageObj, error == nil {
                let negotiated = self?.value(forKey: "_protocol") as? String
                    ?? self?.value(forKey: "subprotocol") as? String
                // Exactly one of `string`/`data` is populated per message —
                // NSURLSessionWebSocketMessage's own documented contract — so
                // checking which is present sidesteps relying on the numeric
                // `type` raw value.
                if let text = messageObj.value(forKey: "string") as? String {
                    tracker.frameReceived(message: .string(text), negotiatedProtocol: negotiated)
                } else if let data = messageObj.value(forKey: "data") as? Data {
                    tracker.frameReceived(message: .data(data), negotiatedProtocol: negotiated)
                }
            } else if error != nil, let self {
                // A receive() error observed on the app's OWN completion handler
                // is a genuine close — Hakka no longer issues a competing
                // receive() of its own, so there's no contended-call case left
                // to filter out here.
                if self.state == .completed {
                    tracker.emitClose(
                        closeCode: self.closeCode.rawValue,
                        reason: self.closeReason.flatMap { String(data: $0, encoding: .utf8) }
                    )
                    HakkaWebSocketMonitor.globalInterceptor.map { tracker.flush(interceptor: $0) }
                }
            } else if error != nil {
                // The task itself has already been deallocated — nothing left
                // to race with, so this is a genuine end.
                tracker.emitClose(closeCode: URLSessionWebSocketTask.CloseCode.abnormalClosure.rawValue, reason: nil)
                HakkaWebSocketMonitor.globalInterceptor.map { tracker.flush(interceptor: $0) }
            }
            originalHandler(messageObj, error)
        }

        imp(self, #selector(hakka_receiveMessageWithCompletionHandler(_:)), wrapped as AnyObject)
    }
}

// MARK: - Test seam

/// Whether `task` currently has a `HakkaWSTracker` attached. Internal (not
/// `private`) so `@testable import` tests can assert wrap/no-wrap behavior
/// directly — `hakkaWSTrackerKey` below is file-scoped and can't be reached
/// from a test file otherwise. Mirrors the `debugHasBridgeClientForTest`
/// test-seam idiom in `Interceptor.swift`.
@available(iOS 13.0, macOS 10.15, *)
func debugHasWSTracker(_ task: URLSessionWebSocketTask) -> Bool {
    objc_getAssociatedObject(task, &hakkaWSTrackerKey) != nil
}

// MARK: - Tracker

nonisolated(unsafe) private var hakkaWSTrackerKey: UInt8 = 0

/// Thread-safe per-task state collector. Records every frame payload.
final class HakkaWSTracker: @unchecked Sendable {
    let taskId: String
    let url: String
    let startTime: Int64

    private let lock = NSLock()
    private var messageCount: Int = 0
    private var frames: [WsMessage] = []
    private var framesDropped = false
    private var negotiatedProtocol: String?
    private var closeCode: Int?
    private var emitted = false

    init(taskId: String, url: String, startTime: Int64) {
        self.taskId = taskId
        self.url = url
        self.startTime = startTime
    }

    func frameReceived(message: URLSessionWebSocketTask.Message, negotiatedProtocol: String?) {
        let ts = Int64(Date().timeIntervalSince1970 * 1000)
        let wsMsg = buildWsMessage(message: message, direction: .received, timestamp: ts)
        lock.lock()
        messageCount += 1
        let startedDropping = recordFrame(wsMsg)
        if self.negotiatedProtocol == nil, let p = negotiatedProtocol, !p.isEmpty {
            self.negotiatedProtocol = p
        }
        lock.unlock()
        if startedDropping { logFramesDropped() }
    }

    func frameSent(message: URLSessionWebSocketTask.Message) {
        let ts = Int64(Date().timeIntervalSince1970 * 1000)
        let wsMsg = buildWsMessage(message: message, direction: .sent, timestamp: ts)
        lock.lock()
        messageCount += 1
        let startedDropping = recordFrame(wsMsg)
        lock.unlock()
        if startedDropping { logFramesDropped() }
    }

    /// Appends `frame` to `frames`, evicting the oldest one once `wsMaxFrames`
    /// is crossed. `messageCount` (above) is incremented unconditionally
    /// before this runs, so it keeps reflecting the TRUE total even once
    /// eviction starts — the emitted request's `wsMessageCount` exceeding
    /// `messages?.count` is what makes a capped connection detectable rather
    /// than silently indistinguishable from a short one. Must be called with
    /// `lock` already held.
    /// - Returns: `true` the first time eviction starts for this connection,
    ///   so the caller can log a one-time warning outside the lock.
    private func recordFrame(_ frame: WsMessage) -> Bool {
        frames.append(frame)
        guard frames.count > wsMaxFrames else { return false }
        frames.removeFirst()
        guard !framesDropped else { return false }
        framesDropped = true
        return true
    }

    /// Logged once per connection, the moment the cap is first crossed —
    /// visible in Console/`log stream` and the Logs inspector panel rather
    /// than a silent drop, so a developer watching a long-lived socket (or
    /// Hakka's own bridge connection) can see why older frames stopped
    /// showing up.
    private func logFramesDropped() {
        HakkaOSLogBridge.shared.warn(
            "WebSocket capture for \(url) exceeded \(wsMaxFrames) frames; oldest frames are being dropped to bound memory. wsMessageCount on the captured request still reflects the true total.",
            category: "network"
        )
    }

    func emitClose(closeCode: Int, reason: String?) {
        lock.lock()
        if self.closeCode == nil {
            self.closeCode = closeCode
        }
        lock.unlock()
    }

    func flush(interceptor: HakkaInterceptor) {
        lock.lock()
        guard !emitted else {
            lock.unlock()
            return
        }
        emitted = true
        let count = messageCount
        let code = closeCode ?? URLSessionWebSocketTask.CloseCode.abnormalClosure.rawValue
        let capturedFrames = frames
        let proto = negotiatedProtocol
        lock.unlock()

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let request = NetworkRequest(
            id: taskId,
            url: url,
            method: .get,
            status: code == URLSessionWebSocketTask.CloseCode.normalClosure.rawValue ? 101 : nil,
            startTime: startTime,
            duration: now - startTime,
            source: .nativeWebSocket,
            wsMessageCount: count,
            wsCloseCode: code,
            messages: capturedFrames.isEmpty ? nil : capturedFrames,
            wsProtocol: proto
        )
        interceptor.didCapture(request)
    }
}

// MARK: - Frame encoding

/// Not `private` so tests can exercise the string/small-binary/oversized-binary
/// encoding cases directly.
func buildWsMessage(
    message: URLSessionWebSocketTask.Message,
    direction: WsDirection,
    timestamp: Int64
) -> WsMessage {
    switch message {
    case .string(let text):
        return WsMessage(
            timestamp: timestamp,
            direction: direction,
            data: .text(text),
            size: text.utf8.count,
            binary: false
        )
    case .data(let data):
        let size = data.count
        if size <= wsBinaryCap {
            return WsMessage(
                timestamp: timestamp,
                direction: direction,
                data: .text(data.base64EncodedString()),
                size: size,
                binary: true
            )
        } else {
            return WsMessage(
                timestamp: timestamp,
                direction: direction,
                data: .byteCount(size),
                size: size,
                binary: true
            )
        }
    @unknown default:
        return WsMessage(
            timestamp: timestamp,
            direction: direction,
            data: .text(""),
            size: 0,
            binary: false
        )
    }
}
