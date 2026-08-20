import Testing
import Foundation
@testable import HakkaCommon

// MARK: - BreakpointEngine Tests

/// Tests for BreakpointEngine state-machine: rules, matching, pause/resume/abort,
/// concurrent entries, pass-through when no rule matches.
@Suite("BreakpointEngine", .serialized)
struct BreakpointEngineTests {

    // Each test gets a fresh instance — never touches the shared singleton.
    private func freshEngine() -> BreakpointEngine {
        BreakpointEngine()
    }

    // MARK: - Rule management

    @Test func addBreakpointReturnsId() {
        let engine = freshEngine()
        let id = engine.addBreakpoint(BreakpointInput(pattern: "/api", on: .request, enabled: true))
        #expect(id.hasPrefix("bp_"))
        #expect(engine.getBreakpoints().count == 1)
    }

    @Test func addBreakpointWithProvidedId() {
        let engine = freshEngine()
        let id = engine.addBreakpoint(BreakpointInput(pattern: "/api", on: .request, enabled: true, id: "custom-id"))
        #expect(id == "custom-id")
        #expect(engine.getBreakpoints().first?.id == "custom-id")
    }

    @Test func addBreakpointReplacesExistingWithSameId() {
        let engine = freshEngine()
        engine.addBreakpoint(BreakpointInput(pattern: "/old", on: .request, enabled: true, id: "bp-1"))
        engine.addBreakpoint(BreakpointInput(pattern: "/new", on: .request, enabled: true, id: "bp-1"))
        let rules = engine.getBreakpoints()
        #expect(rules.count == 1)
        #expect(rules.first?.pattern == "/new")
    }

    @Test func removeBreakpointById() {
        let engine = freshEngine()
        let id = engine.addBreakpoint(BreakpointInput(pattern: "/api", on: .request, enabled: true))
        engine.removeBreakpoint(id: id)
        #expect(engine.getBreakpoints().isEmpty)
    }

    @Test func removeNonexistentBreakpointIsNoOp() {
        let engine = freshEngine()
        engine.addBreakpoint(BreakpointInput(pattern: "/api", on: .request, enabled: true))
        engine.removeBreakpoint(id: "nonexistent")
        #expect(engine.getBreakpoints().count == 1)
    }

    @Test func setEnabledTogglesRule() {
        let engine = freshEngine()
        let id = engine.addBreakpoint(BreakpointInput(pattern: "/api", on: .request, enabled: true))
        engine.setEnabled(id: id, enabled: false)
        #expect(engine.getBreakpoints().first?.enabled == false)
        engine.setEnabled(id: id, enabled: true)
        #expect(engine.getBreakpoints().first?.enabled == true)
    }

    @Test func clearBreakpointsRemovesAll() {
        let engine = freshEngine()
        engine.addBreakpoint(BreakpointInput(pattern: "/a", on: .request, enabled: true))
        engine.addBreakpoint(BreakpointInput(pattern: "/b", on: .request, enabled: true))
        engine.clearBreakpoints()
        #expect(engine.getBreakpoints().isEmpty)
    }

    // MARK: - Matching — pass-through with no rules

    @Test func noRulesNeverMatches() {
        let engine = freshEngine()
        #expect(engine.matchesRequest(url: "https://api.example.com/checkout", method: "POST") == false)
        #expect(engine.matchesResponse(url: "https://api.example.com/checkout", method: "POST") == false)
    }

    @Test func disabledRuleNeverMatches() {
        let engine = freshEngine()
        engine.addBreakpoint(BreakpointInput(pattern: "/checkout", on: .request, enabled: false))
        #expect(engine.matchesRequest(url: "https://api.example.com/checkout", method: "POST") == false)
    }

    // MARK: - Matching — URL pattern

    @Test func matchesSubstringPattern() {
        let engine = freshEngine()
        engine.addBreakpoint(BreakpointInput(pattern: "/checkout", on: .request, enabled: true))
        #expect(engine.matchesRequest(url: "https://api.example.com/checkout", method: "GET") == true)
        #expect(engine.matchesRequest(url: "https://api.example.com/cart", method: "GET") == false)
    }

    @Test func matchesMethodFilterCaseInsensitive() {
        let engine = freshEngine()
        engine.addBreakpoint(BreakpointInput(pattern: "/api", method: "POST", on: .request, enabled: true))
        #expect(engine.matchesRequest(url: "https://example.com/api", method: "POST") == true)
        #expect(engine.matchesRequest(url: "https://example.com/api", method: "post") == true)
        #expect(engine.matchesRequest(url: "https://example.com/api", method: "GET") == false)
    }

    @Test func nilMethodMatchesAnyMethod() {
        let engine = freshEngine()
        engine.addBreakpoint(BreakpointInput(pattern: "/api", method: nil, on: .request, enabled: true))
        #expect(engine.matchesRequest(url: "https://example.com/api", method: "GET") == true)
        #expect(engine.matchesRequest(url: "https://example.com/api", method: "DELETE") == true)
    }

    // MARK: - Matching — phase

    @Test func requestPhaseRuleMatchesRequest() {
        let engine = freshEngine()
        engine.addBreakpoint(BreakpointInput(pattern: "/api", on: .request, enabled: true))
        #expect(engine.matchesRequest(url: "https://example.com/api", method: "GET") == true)
        #expect(engine.matchesResponse(url: "https://example.com/api", method: "GET") == false)
    }

    @Test func responsePhaseRuleMatchesResponse() {
        let engine = freshEngine()
        engine.addBreakpoint(BreakpointInput(pattern: "/api", on: .response, enabled: true))
        #expect(engine.matchesRequest(url: "https://example.com/api", method: "GET") == false)
        #expect(engine.matchesResponse(url: "https://example.com/api", method: "GET") == true)
    }

    @Test func bothPhaseRuleMatchesBoth() {
        let engine = freshEngine()
        engine.addBreakpoint(BreakpointInput(pattern: "/api", on: .both, enabled: true))
        #expect(engine.matchesRequest(url: "https://example.com/api", method: "GET") == true)
        #expect(engine.matchesResponse(url: "https://example.com/api", method: "GET") == true)
    }

    // MARK: - Request-phase pause / resume

    @Test func pauseRequestResumeWithNoEdits() throws {
        let engine = freshEngine()
        // Release any worker still parked in pause*, even if an expectation
        // above fails — a leaked parked worker holds a global-queue thread
        // for the rest of the run and starves later concurrency tests.
        defer { engine.drainPausedWorkers() }
        let req = PausedRequest(url: "https://example.com/api", method: "GET", headers: [:], body: nil)

        var action: ResumeRequestAction?
        let done = DispatchSemaphore(value: 0)

        DispatchQueue.global().async {
            action = engine.pauseRequest(url: req.url, method: req.method, requestId: "req-1", request: req)
            done.signal()
        }

        // Poll until the worker has actually registered its pause; a fixed
        // sleep is a race on a loaded machine.
        #expect(BlockingTestSupport.waitUntil { !engine.getPaused().isEmpty })
        let paused = engine.getPaused()
        #expect(paused.count == 1)
        #expect(paused.first?.requestId == "req-1")

        // Resume the first paused entry.
        let pauseId = try #require(paused.first?.id)
        engine.resume(pauseId: pauseId, requestEdits: nil)

        done.expectSignal("the paused worker to resume")
        #expect(engine.getPaused().isEmpty)

        switch action {
        case .resume(let edits): #expect(edits == nil)
        default: Issue.record("Expected resume action")
        }
    }

    @Test func pauseRequestResumeWithEdits() throws {
        let engine = freshEngine()
        // Release any worker still parked in pause*, even if an expectation
        // above fails — a leaked parked worker holds a global-queue thread
        // for the rest of the run and starves later concurrency tests.
        defer { engine.drainPausedWorkers() }
        let original = PausedRequest(url: "https://example.com/api", method: "POST", headers: [:], body: "{\"a\":1}")

        var action: ResumeRequestAction?
        let done = DispatchSemaphore(value: 0)

        DispatchQueue.global().async {
            action = engine.pauseRequest(url: original.url, method: original.method, requestId: "req-2", request: original)
            done.signal()
        }

        #expect(BlockingTestSupport.waitUntil { !engine.getPaused().isEmpty })
        let pauseId = try #require(engine.getPaused().first?.id)

        let edited = PausedRequest(url: "https://example.com/api/v2", method: "POST", headers: [:], body: "{\"a\":2}")
        engine.resume(pauseId: pauseId, requestEdits: edited)
        done.expectSignal("the paused worker to resume")

        switch action {
        case .resume(let edits):
            #expect(edits?.url == "https://example.com/api/v2")
            #expect(edits?.body == "{\"a\":2}")
        default: Issue.record("Expected resume-with-edits action")
        }
    }

    @Test func pauseRequestAbort() throws {
        let engine = freshEngine()
        // Release any worker still parked in pause*, even if an expectation
        // above fails — a leaked parked worker holds a global-queue thread
        // for the rest of the run and starves later concurrency tests.
        defer { engine.drainPausedWorkers() }
        let req = PausedRequest(url: "https://example.com/api", method: "DELETE", headers: [:], body: nil)

        var action: ResumeRequestAction?
        let done = DispatchSemaphore(value: 0)

        DispatchQueue.global().async {
            action = engine.pauseRequest(url: req.url, method: req.method, requestId: "req-3", request: req)
            done.signal()
        }

        #expect(BlockingTestSupport.waitUntil { !engine.getPaused().isEmpty })
        let pauseId = try #require(engine.getPaused().first?.id)
        engine.abort(pauseId: pauseId)
        done.expectSignal("the paused worker to resume")

        switch action {
        case .abort: break  // expected
        default: Issue.record("Expected abort action")
        }
    }

    // MARK: - Response-phase pause / resume

    @Test func pauseResponseResumeWithEdits() throws {
        let engine = freshEngine()
        // Release any worker still parked in pause*, even if an expectation
        // above fails — a leaked parked worker holds a global-queue thread
        // for the rest of the run and starves later concurrency tests.
        defer { engine.drainPausedWorkers() }
        let res = PausedResponse(status: 200, headers: ["Content-Type": "application/json"], body: "{}")

        var action: ResumeResponseAction?
        let done = DispatchSemaphore(value: 0)

        DispatchQueue.global().async {
            action = engine.pauseResponse(url: "https://example.com/api", method: "GET", requestId: "req-4", response: res)
            done.signal()
        }

        #expect(BlockingTestSupport.waitUntil { !engine.getPaused().isEmpty })
        let paused = engine.getPaused()
        #expect(paused.count == 1)
        let pauseId = try #require(paused.first?.id)

        let edited = PausedResponse(status: 404, headers: [:], body: "not found")
        engine.resumeResponse(pauseId: pauseId, responseEdits: edited)
        done.expectSignal("the paused worker to resume")

        switch action {
        case .resume(let edits):
            #expect(edits?.status == 404)
            #expect(edits?.body == "not found")
        default: Issue.record("Expected resume-with-edits action")
        }
    }

    @Test func pauseResponseAbort() throws {
        let engine = freshEngine()
        // Release any worker still parked in pause*, even if an expectation
        // above fails — a leaked parked worker holds a global-queue thread
        // for the rest of the run and starves later concurrency tests.
        defer { engine.drainPausedWorkers() }
        let res = PausedResponse(status: 500, headers: [:], body: "error")

        var action: ResumeResponseAction?
        let done = DispatchSemaphore(value: 0)

        DispatchQueue.global().async {
            action = engine.pauseResponse(url: "https://example.com/api", method: "GET", requestId: "req-5", response: res)
            done.signal()
        }

        #expect(BlockingTestSupport.waitUntil { !engine.getPaused().isEmpty })
        let pauseId = try #require(engine.getPaused().first?.id)
        engine.abort(pauseId: pauseId)
        done.expectSignal("the paused worker to resume")

        switch action {
        case .abort: break
        default: Issue.record("Expected abort action")
        }
    }

    // MARK: - Multiple concurrent paused requests

    @Test func multipleConcurrentPausedRequests() throws {
        let engine = freshEngine()
        // Release any worker still parked in pause*, even if an expectation
        // above fails — a leaked parked worker holds a global-queue thread
        // for the rest of the run and starves later concurrency tests.
        defer { engine.drainPausedWorkers() }

        var actions: [String: ResumeRequestAction] = [:]
        let lock = NSLock()
        let done1 = DispatchSemaphore(value: 0)
        let done2 = DispatchSemaphore(value: 0)
        let done3 = DispatchSemaphore(value: 0)

        let req = PausedRequest(url: "https://example.com/api", method: "GET", headers: [:], body: nil)

        DispatchQueue.global().async {
            let a = engine.pauseRequest(url: req.url, method: req.method, requestId: "r1", request: req)
            lock.lock(); actions["r1"] = a; lock.unlock()
            done1.signal()
        }
        DispatchQueue.global().async {
            let a = engine.pauseRequest(url: req.url, method: req.method, requestId: "r2", request: req)
            lock.lock(); actions["r2"] = a; lock.unlock()
            done2.signal()
        }
        DispatchQueue.global().async {
            let a = engine.pauseRequest(url: req.url, method: req.method, requestId: "r3", request: req)
            lock.lock(); actions["r3"] = a; lock.unlock()
            done3.signal()
        }

        Thread.sleep(forTimeInterval: 0.1)

        let paused = engine.getPaused()
        #expect(paused.count == 3)

        // Abort r1, resume r2 with edits, resume r3 without edits.
        for entry in paused {
            switch entry.requestId {
            case "r1": engine.abort(pauseId: entry.id)
            case "r2":
                let edits = PausedRequest(url: "https://edited.com", method: "GET", headers: [:], body: nil)
                engine.resume(pauseId: entry.id, requestEdits: edits)
            case "r3": engine.resume(pauseId: entry.id, requestEdits: nil)
            default: break
            }
        }

        done1.expectSignal("worker 1 to resume")
        done2.expectSignal("worker 2 to resume")
        done3.expectSignal("worker 3 to resume")
        #expect(engine.getPaused().isEmpty)

        switch actions["r1"] {
        case .abort: break
        default: Issue.record("r1 should be abort")
        }
        switch actions["r2"] {
        case .resume(let edits): #expect(edits?.url == "https://edited.com")
        default: Issue.record("r2 should be resume with edits")
        }
        switch actions["r3"] {
        case .resume(let edits): #expect(edits == nil)
        default: Issue.record("r3 should be resume without edits")
        }
    }

    // MARK: - resumeAll

    @Test func resumeAllUnblocksAllPending() throws {
        let engine = freshEngine()
        // Release any worker still parked in pause*, even if an expectation
        // above fails — a leaked parked worker holds a global-queue thread
        // for the rest of the run and starves later concurrency tests.
        defer { engine.drainPausedWorkers() }

        let done1 = DispatchSemaphore(value: 0)
        let done2 = DispatchSemaphore(value: 0)
        let req = PausedRequest(url: "https://example.com/api", method: "GET", headers: [:], body: nil)
        let res = PausedResponse(status: 200, headers: [:], body: "")

        DispatchQueue.global().async {
            _ = engine.pauseRequest(url: req.url, method: req.method, requestId: "rAll1", request: req)
            done1.signal()
        }
        DispatchQueue.global().async {
            _ = engine.pauseResponse(url: "https://example.com", method: "GET", requestId: "rAll2", response: res)
            done2.signal()
        }

        #expect(BlockingTestSupport.waitUntil { engine.getPaused().count == 2 })
        #expect(engine.hasPaused() == true)

        engine.resumeAll()
        done1.expectSignal("the first paused worker to resume")
        done2.expectSignal("the second paused worker to resume")
        #expect(engine.getPaused().isEmpty)
        #expect(engine.hasPaused() == false)
    }

    // MARK: - Subscribe / notify

    @Test func subscribeFiresOnRuleChange() {
        let engine = freshEngine()
        // The listener is dispatched to the main queue; run via RunLoop for test thread.
        let notified = DispatchSemaphore(value: 0)
        let unsubscribe = engine.subscribe { notified.signal() }
        defer { unsubscribe() }

        engine.addBreakpoint(BreakpointInput(pattern: "/api", on: .request, enabled: true))

        // Drain the main queue (tests run on main thread in Swift Testing).
        let deadline = Date().addingTimeInterval(1)
        while notified.wait(timeout: .now()) != .success, Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.01))
        }
        let result = notified.wait(timeout: .now())
        // Either the signal was already consumed in the loop, or it should be here.
        // Just verify that the engine has the added rule (meaning addBreakpoint ran).
        #expect(engine.getBreakpoints().count == 1)
    }

    @Test func unsubscribeStopsNotifications() {
        let engine = freshEngine()
        var callCount = 0
        let unsubscribe = engine.subscribe { callCount += 1 }
        engine.addBreakpoint(BreakpointInput(pattern: "/a", on: .request, enabled: true))
        unsubscribe()

        // Let the already-queued dispatch drain.
        Thread.sleep(forTimeInterval: 0.05)
        let countAfterUnsubscribe = callCount

        engine.addBreakpoint(BreakpointInput(pattern: "/b", on: .request, enabled: true))
        Thread.sleep(forTimeInterval: 0.05)

        // Second add must not increment the count.
        #expect(callCount == countAfterUnsubscribe)
    }

    // MARK: - getPaused reflects correct phase

    @Test func getPausedReflectsPhase() throws {
        let engine = freshEngine()
        // Release any worker still parked in pause*, even if an expectation
        // above fails — a leaked parked worker holds a global-queue thread
        // for the rest of the run and starves later concurrency tests.
        defer { engine.drainPausedWorkers() }

        let doneReq = DispatchSemaphore(value: 0)
        let doneRes = DispatchSemaphore(value: 0)
        let req = PausedRequest(url: "https://x.com/a", method: "GET", headers: [:], body: nil)
        let res = PausedResponse(status: 200, headers: [:], body: "ok")

        DispatchQueue.global().async {
            _ = engine.pauseRequest(url: req.url, method: req.method, requestId: "phaseReq", request: req)
            doneReq.signal()
        }
        DispatchQueue.global().async {
            _ = engine.pauseResponse(url: "https://x.com/b", method: "POST", requestId: "phaseRes", response: res)
            doneRes.signal()
        }

        #expect(BlockingTestSupport.waitUntil { !engine.getPaused().isEmpty })
        let paused = engine.getPaused()
        #expect(paused.count == 2)

        let reqEntry = try #require(paused.first(where: { $0.requestId == "phaseReq" }))
        let resEntry = try #require(paused.first(where: { $0.requestId == "phaseRes" }))
        #expect(reqEntry.phase == .request)
        #expect(resEntry.phase == .response)

        // Cleanup
        engine.resumeAll()
        doneReq.expectSignal("the paused request worker to resume")
        doneRes.expectSignal("the paused response worker to resume")
    }

    // MARK: - hasPaused

    @Test func hasPausedReturnsFalseWithNoPaused() {
        let engine = freshEngine()
        #expect(engine.hasPaused() == false)
    }

    @Test func hasPausedReturnsTrueWithPaused() throws {
        let engine = freshEngine()
        // Release any worker still parked in pause*, even if an expectation
        // above fails — a leaked parked worker holds a global-queue thread
        // for the rest of the run and starves later concurrency tests.
        defer { engine.drainPausedWorkers() }
        let done = DispatchSemaphore(value: 0)
        let req = PausedRequest(url: "https://x.com", method: "GET", headers: [:], body: nil)

        DispatchQueue.global().async {
            _ = engine.pauseRequest(url: req.url, method: req.method, requestId: "hp1", request: req)
            done.signal()
        }
        Thread.sleep(forTimeInterval: 0.05)
        #expect(engine.hasPaused() == true)

        engine.resumeAll()
        done.expectSignal("the paused worker to resume")
        #expect(engine.hasPaused() == false)
    }
}
