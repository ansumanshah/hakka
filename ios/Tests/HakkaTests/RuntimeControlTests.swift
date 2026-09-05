import Foundation
@testable import HakkaCommon
import Testing

struct RuntimeControlTests {
    private func fixture(_ name: String) throws -> String {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: root.appendingPathComponent("fixtures/runtime-control/\(name).json"), encoding: .utf8)
    }

    @Test func sharedFixturesMatchNativeContract() throws {
        for name in ["hello", "welcome", "targets", "request", "applied", "failed"] {
            #expect(try parseRuntimeControlFrame(fixture(name)) != nil)
        }
        guard case let .hello(role, runtime, capabilities) = try parseRuntimeControlFrame(fixture("hello")) else {
            Issue.record("hello fixture was not parsed"); return
        }
        #expect(role == "runtime")
        #expect(runtime == "ios")
        #expect(capabilities == RuntimeControlFrame.nativeCapabilities)
        #expect(!capabilities.contains("request.replay"))
        #expect(!capabilities.contains("storage.set"))
    }

    @Test func exactTargetDuplicateAndFailedApplication() throws {
        let session = RuntimeControlSession()
        let request = try #require(parseRuntimeControlFrame(fixture("request")))
        var calls = 0
        #expect(session.receive(request, apply: { _ in calls += 1; return .ok }) == nil)
        _ = session.receive(.welcome(targetId: "target-b"), apply: { _ in .ok })
        #expect(session.receive(request, apply: { _ in calls += 1; return .ok }) == nil)
        #expect(calls == 0)
        session.reset()
        _ = session.receive(.welcome(targetId: "target-a"), apply: { _ in .ok })
        let first = session.receive(request) { _ in calls += 1; return .failure("secret credential") }
        let repeated = session.receive(request) { _ in calls += 1; return .ok }
        #expect(first?.error == "apply_failed")
        #expect(repeated == first)
        #expect(calls == 1)
        let raw = try #require(encodeRuntimeControlFrame("control.result", payload: first))
        #expect(!raw.contains("secret credential"))
        session.reset()
        _ = session.receive(.welcome(targetId: "target-a"), apply: { _ in .ok })
        #expect(session.receive(request, apply: { _ in calls += 1; return .ok })?.status == "applied")
        #expect(calls == 2)
    }

    @Test func replayIsParsedForRoutingButNeverAppliedNatively() throws {
        let session = RuntimeControlSession()
        _ = session.receive(.welcome(targetId: "target-a"), apply: { _ in .ok })
        let raw = #"{"type":"control.request","payload":{"commandId":"replay-1","targetId":"target-a","timeoutMs":1,"command":{"kind":"request.replay","requestId":"record-1"}}}"#
        let request = try #require(parseRuntimeControlFrame(raw))
        let result = session.receive(request) { _ in Issue.record("replay reached native engines"); return .ok }
        #expect(result?.error == "unsupported_capability")
    }

    @Test func duplicateCacheDoesNotForgetAppliedCommandsAtCapacity() throws {
        let session = RuntimeControlSession()
        _ = session.receive(.welcome(targetId: "target-a"), apply: { _ in .ok })
        let template = try fixture("request")
        var applied = 0
        for index in 0 ..< 1025 {
            let frame = try #require(parseRuntimeControlFrame(template.replacingOccurrences(of: "command-1", with: "command-\(index)")))
            let result = session.receive(frame) { _ in applied += 1; return .ok }
            #expect(result?.status == (index < 1024 ? "applied" : "failed"))
        }
        let first = try #require(parseRuntimeControlFrame(template.replacingOccurrences(of: "command-1", with: "command-0")))
        #expect(session.receive(first, apply: { _ in applied += 1; return .ok })?.status == "applied")
        #expect(applied == 1024)
    }

    @Test func malformedProtocolFieldsAreRejected() throws {
        let request = try fixture("request")
        for value in ["true", "0", "30001", "1.5"] {
            #expect(parseRuntimeControlFrame(request.replacingOccurrences(of: "5000", with: value)) == nil)
        }
        let hello = try fixture("hello")
        #expect(parseRuntimeControlFrame(hello.replacingOccurrences(of: "\"protocolVersion\": 1", with: "\"protocolVersion\": true")) == nil)
        #expect(parseRuntimeControlFrame(hello.replacingOccurrences(of: "mock.add", with: "storage.set")) == nil)
        #expect(try parseRuntimeControlFrame(fixture("applied").replacingOccurrences(of: "\"status\": \"applied\"", with: "\"status\": \"applied\", \"error\": \"apply_failed\"")) == nil)
    }
}
