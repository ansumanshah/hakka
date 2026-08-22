import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore

/// Byte-compat for the control-channel payload encoder. The expected bytes
/// are literals cross-checked against the pinned contract
/// (`packages/hakka-core/src/engine/control.ts` and its tests) — field
/// names, kinds, and profiles must match what devices already parse, and
/// the optional-field-absent shapes must match the field-absent forms those
/// tests pin. Key order is `.sortedKeys`; Apple's serializer escapes `/`
/// as `\/` (same JSON, accepted by every parser in the fleet).
@Suite("ControlCommandEncoder bytes")
struct ControlCommandEncoderTests {
    @Test(
        "each command kind encodes to the pinned wire bytes",
        arguments: [
            (
                "mock.add minimal",
                ControlCommand.mockAdd(
                    id: "ext-1",
                    rule: MockRuleInput(pattern: "/api/users", response: MockResponse(status: 200, body: "[]"))
                ),
                #"{"kind":"mock.add","rule":{"enabled":true,"id":"ext-1","pattern":"\/api\/users","response":{"body":"[]","status":200}}}"#
            ),
            (
                "mock.remove",
                ControlCommand.mockRemove(id: "ext-1"),
                #"{"id":"ext-1","kind":"mock.remove"}"#
            ),
            (
                "mock.clear",
                ControlCommand.mockClear,
                #"{"kind":"mock.clear"}"#
            ),
            (
                "breakpoint.add minimal",
                ControlCommand.breakpointAdd(
                    id: "bp-ext-1",
                    breakpoint: BreakpointInput(pattern: "/api/checkout", enabled: true)
                ),
                #"{"breakpoint":{"enabled":true,"id":"bp-ext-1","on":"request","pattern":"\/api\/checkout"},"kind":"breakpoint.add"}"#
            ),
            (
                "breakpoint.add with method and phase",
                ControlCommand.breakpointAdd(
                    id: "bp-ext-2",
                    breakpoint: BreakpointInput(pattern: "/x", method: "post", on: .both, enabled: true)
                ),
                #"{"breakpoint":{"enabled":true,"id":"bp-ext-2","method":"post","on":"both","pattern":"\/x"},"kind":"breakpoint.add"}"#
            ),
            (
                "breakpoint.remove",
                ControlCommand.breakpointRemove(id: "bp-ext-1"),
                #"{"id":"bp-ext-1","kind":"breakpoint.remove"}"#
            ),
            (
                "breakpoint.abort",
                ControlCommand.breakpointAbort(pauseId: "pause_1"),
                #"{"kind":"breakpoint.abort","pauseId":"pause_1"}"#
            ),
            (
                "breakpoint.resume with no edits",
                ControlCommand.breakpointResume(pauseId: "pause_1", requestEdits: nil, responseEdits: nil),
                #"{"kind":"breakpoint.resume","pauseId":"pause_1"}"#
            ),
            (
                "breakpoint.resume with requestEdits only",
                ControlCommand.breakpointResume(
                    pauseId: "pause_1",
                    requestEdits: BreakpointRequestEdits(method: "POST"),
                    responseEdits: nil
                ),
                #"{"kind":"breakpoint.resume","pauseId":"pause_1","requestEdits":{"method":"POST"}}"#
            ),
            (
                "breakpoint.resume with responseEdits only",
                ControlCommand.breakpointResume(
                    pauseId: "pause_1",
                    requestEdits: nil,
                    responseEdits: BreakpointResponseEdits(status: 500, headers: ["x-a": "1"])
                ),
                #"{"kind":"breakpoint.resume","pauseId":"pause_1","responseEdits":{"headers":{"x-a":"1"},"status":500}}"#
            ),
            (
                "throttle.set none",
                ControlCommand.throttleSet(profile: .none, latencyMs: nil, downloadKbps: nil),
                #"{"kind":"throttle.set","profile":"none"}"#
            ),
            (
                "throttle.set preset",
                ControlCommand.throttleSet(profile: .fast3g, latencyMs: nil, downloadKbps: nil),
                #"{"kind":"throttle.set","profile":"fast-3g"}"#
            ),
            (
                "throttle.set custom",
                ControlCommand.throttleSet(profile: .custom, latencyMs: 200, downloadKbps: 500),
                #"{"downloadKbps":500,"kind":"throttle.set","latencyMs":200,"profile":"custom"}"#
            ),
        ]
    )
    func pinnedBytes(_ label: String, _ command: ControlCommand, _ expected: String) throws {
        #expect(try ControlCommandEncoder.encodePayload(command) == Data(expected.utf8), "\(label)")
    }

    @Test("mock.add with every optional field populated")
    func mockAddFull() throws {
        let command = ControlCommand.mockAdd(
            id: "ext-2",
            rule: MockRuleInput(
                pattern: "foo",
                isRegex: false,
                regexFlags: nil,
                method: "POST",
                response: MockResponse(
                    status: 201,
                    headers: ["x-a": "b"],
                    body: "{\"ok\":true}",
                    delay: 0.05
                ),
                enabled: false,
                redirectTo: "https://example.com",
                block: true,
                modify: MockRuleModify(
                    setRequestHeaders: ["x-added": "1"],
                    removeRequestHeaders: ["x-secret"],
                    setQueryParams: ["debug": "1"],
                    removeQueryParams: ["token"],
                    status: 201,
                    setResponseHeaders: ["x-res": "a"],
                    removeResponseHeaders: ["x-drop"],
                    replaceBody: [.init(find: "foo", replace: "bar")]
                ),
                failure: MockFailure(code: .timeout),
                skipCount: 2,
                stopAfter: 5
            )
        )
        #expect(
            try ControlCommandEncoder.encodePayload(command)
                == Data(
                    #"{"kind":"mock.add","rule":{"block":true,"enabled":false,"failure":{"code":"timeout"},"id":"ext-2","method":"POST","modify":{"removeQueryParams":["token"],"removeRequestHeaders":["x-secret"],"removeResponseHeaders":["x-drop"],"replaceBody":[{"find":"foo","replace":"bar"}],"setQueryParams":{"debug":"1"},"setRequestHeaders":{"x-added":"1"},"setResponseHeaders":{"x-res":"a"},"status":201},"pattern":"foo","redirectTo":"https:\/\/example.com","response":{"body":"{\"ok\":true}","delay":50,"headers":{"x-a":"b"},"status":201},"skipCount":2,"stopAfter":5}}"#
                        .utf8
                )
        )
    }

    @Test("mock.add encodes headerValues alongside headers — additive multi-value widening")
    func mockAddWithHeaderValues() throws {
        // Two Set-Cookie values: `headers` still carries the representative
        // first value (old decoders keep working), `headerValues` carries
        // the full list. See `MockResponse.headerValues`'s doc.
        let command = ControlCommand.mockAdd(
            id: "ext-cookies",
            rule: MockRuleInput(
                pattern: "/login",
                response: MockResponse(
                    status: 200,
                    headers: ["Set-Cookie": "session=abc"],
                    headerValues: ["Set-Cookie": ["session=abc", "consent=yes"]],
                    body: ""
                )
            )
        )
        #expect(
            try ControlCommandEncoder.encodePayload(command)
                == Data(
                    #"{"kind":"mock.add","rule":{"enabled":true,"id":"ext-cookies","pattern":"\/login","response":{"body":"","headers":{"Set-Cookie":"session=abc"},"headerValues":{"Set-Cookie":["session=abc","consent=yes"]},"status":200}}}"#
                        .utf8
                )
        )
    }

    @Test("mock.add omits headerValues when every header has one value — field-absent shape")
    func mockAddOmitsHeaderValuesWhenEmpty() throws {
        let command = ControlCommand.mockAdd(
            id: "ext-plain",
            rule: MockRuleInput(pattern: "/x", response: MockResponse(status: 200, headers: ["x-a": "b"], body: ""))
        )
        let payloadString = String(decoding: try ControlCommandEncoder.encodePayload(command), as: UTF8.self)
        #expect(!payloadString.contains("headerValues"))
    }

    @Test("mock.add omits failure/skipCount/stopAfter when absent/zero — field-absent shape")
    func mockAddOmitsSkipStopFailureWhenAbsent() throws {
        let command = ControlCommand.mockAdd(
            id: "ext-bare",
            rule: MockRuleInput(pattern: "/x", response: MockResponse(status: 200, body: "[]"))
        )
        let payload = try ControlCommandEncoder.encodePayload(command)
        let text = String(data: payload, encoding: .utf8)!
        #expect(!text.contains("failure"))
        #expect(!text.contains("skipCount"))
        #expect(!text.contains("stopAfter"))
    }

    @Test("mock.add with only skipCount/stopAfter (no failure)")
    func mockAddSkipStopOnly() throws {
        let command = ControlCommand.mockAdd(
            id: "ext-skip",
            rule: MockRuleInput(
                pattern: "/x",
                response: MockResponse(status: 200, body: "[]"),
                skipCount: 3,
                stopAfter: 10
            )
        )
        #expect(
            try ControlCommandEncoder.encodePayload(command)
                == Data(
                    #"{"kind":"mock.add","rule":{"enabled":true,"id":"ext-skip","pattern":"\/x","response":{"body":"[]","status":200},"skipCount":3,"stopAfter":10}}"#
                        .utf8
                )
        )
    }

    @Test("mock.add with only failure (no skip/stop)")
    func mockAddFailureOnly() throws {
        let command = ControlCommand.mockAdd(
            id: "ext-fail",
            rule: MockRuleInput(
                pattern: "/x",
                response: MockResponse(status: 200, body: "[]"),
                failure: MockFailure(code: .noConnection)
            )
        )
        #expect(
            try ControlCommandEncoder.encodePayload(command)
                == Data(
                    #"{"kind":"mock.add","rule":{"enabled":true,"failure":{"code":"noConnection"},"id":"ext-fail","pattern":"\/x","response":{"body":"[]","status":200}}}"#
                        .utf8
                )
        )
    }

    @Test("a nil mock body encodes as the empty string, never null")
    func nilBodyBecomesEmptyString() throws {
        let command = ControlCommand.mockAdd(
            id: "ext-empty",
            rule: MockRuleInput(pattern: "/x", response: MockResponse(status: 204))
        )
        #expect(
            try ControlCommandEncoder.encodePayload(command)
                == Data(#"{"kind":"mock.add","rule":{"enabled":true,"id":"ext-empty","pattern":"\/x","response":{"body":"","status":204}}}"#.utf8)
        )
    }

    @Test("encoded payloads re-parse into the same command", arguments: [
        ControlCommand.mockAdd(
            id: "rt-1",
            rule: MockRuleInput(
                pattern: "/api/data",
                method: "GET",
                response: MockResponse(status: 200, headers: ["x-a": "b"], body: "[]", delay: 0.25),
                enabled: false
            )
        ),
        ControlCommand.mockAdd(
            id: "rt-modify",
            rule: MockRuleInput(
                pattern: "/api/data",
                response: MockResponse(status: 200, body: "{}"),
                modify: MockRuleModify(removeQueryParams: ["token"], replaceBody: [.init(find: "a", replace: "b")])
            )
        ),
        ControlCommand.breakpointAdd(
            id: "rt-bp",
            breakpoint: BreakpointInput(pattern: "/checkout", method: "post", on: .response, enabled: false)
        ),
        ControlCommand.breakpointResume(
            pauseId: "rt-pause-1",
            requestEdits: BreakpointRequestEdits(url: "https://api.example.com/x", method: "POST", headers: ["x-a": "b"], body: "{}"),
            responseEdits: nil
        ),
        ControlCommand.breakpointResume(
            pauseId: "rt-pause-2",
            requestEdits: nil,
            responseEdits: BreakpointResponseEdits(status: 500, headers: ["x-a": "b"], body: "err")
        ),
        ControlCommand.breakpointAbort(pauseId: "rt-pause-3"),
        ControlCommand.throttleSet(profile: .custom, latencyMs: 777, downloadKbps: 42),
        ControlCommand.throttleSet(profile: .offline, latencyMs: nil, downloadKbps: nil),
    ])
    func roundTripsThroughTheDeviceParser(_ command: ControlCommand) throws {
        let data = try ControlCommandEncoder.encodePayload(command)
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(parseControlCommand(object) == command)
    }

    // MARK: - Hostile input fails loudly

    @Test("hostile ids throw instead of encoding", arguments: [
        "",
        "has space",
        "a/b/c",
        "../../etc/passwd",
        String(repeating: "a", count: 65),
        "bp:1",
        "räksmörgås",
    ])
    func hostileIDsThrow(_ id: String) {
        let rule = MockRuleInput(pattern: "/x", response: MockResponse(status: 200, body: ""))
        #expect(throws: ControlWireError.invalidRuleID(id)) {
            _ = try ControlCommandEncoder.encodePayload(.mockAdd(id: id, rule: rule))
        }
        #expect(throws: ControlWireError.invalidRuleID(id)) {
            _ = try ControlCommandEncoder.encodePayload(.mockRemove(id: id))
        }
        #expect(throws: ControlWireError.invalidRuleID(id)) {
            _ = try ControlCommandEncoder.encodePayload(
                .breakpointAdd(id: id, breakpoint: BreakpointInput(pattern: "/x", enabled: true)))
        }
        #expect(throws: ControlWireError.invalidRuleID(id)) {
            _ = try ControlCommandEncoder.encodePayload(.breakpointRemove(id: id))
        }
    }

    @Test("empty pauseId throws instead of encoding, unlike an external id it is not charset-restricted")
    func emptyPauseIDThrows() {
        #expect(throws: ControlWireError.invalidRuleID("")) {
            _ = try ControlCommandEncoder.encodePayload(.breakpointAbort(pauseId: ""))
        }
        #expect(throws: ControlWireError.invalidRuleID("")) {
            _ = try ControlCommandEncoder.encodePayload(.breakpointResume(pauseId: "", requestEdits: nil, responseEdits: nil))
        }
    }

    /// Unlike `mock.add`/`breakpoint.add` ids, a pause id is minted by the
    /// device — a colon or unicode character must NOT throw here (only
    /// emptiness does). Confirms the encoder does not over-apply the
    /// external-id charset rule to pause ids.
    @Test("pause ids are not charset-restricted like external ids")
    func pauseIDsSkipTheExternalIDCharset() throws {
        let data = try ControlCommandEncoder.encodePayload(.breakpointAbort(pauseId: "device:pause#7"))
        #expect(data == Data(#"{"kind":"breakpoint.abort","pauseId":"device:pause#7"}"#.utf8))
    }

    /// `breakpoint.paused` is device -> host only — the encoder must refuse
    /// to produce it rather than silently emitting a frame no device would
    /// ever receive from a host.
    @Test("breakpoint.paused throws unsupportedDirection instead of encoding")
    func breakpointPausedThrowsUnsupportedDirection() {
        #expect(throws: ControlWireError.unsupportedDirection("breakpoint.paused")) {
            _ = try ControlCommandEncoder.encodePayload(
                .breakpointPaused(
                    pauseId: "pause_1",
                    ruleId: nil,
                    phase: .request,
                    device: "ios-simulator",
                    request: BreakpointPausedRequestSnapshot(url: "https://api.example.com/x", method: "GET", headers: [:]),
                    response: nil
                )
            )
        }
    }

    @Test("empty patterns throw instead of encoding")
    func emptyPatternsThrow() {
        #expect(throws: ControlWireError.emptyPattern) {
            _ = try ControlCommandEncoder.encodePayload(
                .mockAdd(id: "a", rule: MockRuleInput(pattern: "", response: MockResponse(status: 200, body: ""))))
        }
        #expect(throws: ControlWireError.emptyPattern) {
            _ = try ControlCommandEncoder.encodePayload(
                .breakpointAdd(id: "a", breakpoint: BreakpointInput(pattern: "", enabled: true)))
        }
    }

    @Test("invalid delay, latency, and bandwidth throw instead of encoding")
    func invalidNumbersThrow() {
        #expect(throws: ControlWireError.invalidDelay(-0.5)) {
            _ = try ControlCommandEncoder.encodePayload(
                .mockAdd(id: "a", rule: MockRuleInput(pattern: "/x", response: MockResponse(status: 200, body: "", delay: -0.5))))
        }
        // NaN never compares equal to itself, so `#expect(throws:)` cannot
        // match the payload by Equatable — match the case by pattern instead.
        do {
            _ = try ControlCommandEncoder.encodePayload(
                .mockAdd(id: "a", rule: MockRuleInput(pattern: "/x", response: MockResponse(status: 200, body: "", delay: .nan))))
            Issue.record("expected invalidDelay to be thrown")
        } catch ControlWireError.invalidDelay {
            // success
        } catch {
            Issue.record("unexpected error \(error)")
        }
        #expect(throws: ControlWireError.invalidLatencyMs(-5)) {
            _ = try ControlCommandEncoder.encodePayload(.throttleSet(profile: .custom, latencyMs: -5, downloadKbps: nil))
        }
        #expect(throws: ControlWireError.invalidDownloadKbps(-1)) {
            _ = try ControlCommandEncoder.encodePayload(.throttleSet(profile: .custom, latencyMs: nil, downloadKbps: -1))
        }
    }

    /// The wire shape carries no regex/mode vocabulary: `mock.add` patterns
    /// are substrings on devices, and rewrite routing derives from
    /// `redirectTo`/`modify`. Asserting their absence keeps the encoder from
    /// ever inventing fields the contract does not define.
    @Test("a regex-authored rule encodes without regex or mode fields")
    func regexFieldsStayOffTheWire() throws {
        let command = ControlCommand.mockAdd(
            id: "re-1",
            rule: MockRuleInput(pattern: "/x", isRegex: true, regexFlags: "i", response: MockResponse(status: 200, body: ""))
        )
        let text = String(decoding: try ControlCommandEncoder.encodePayload(command), as: UTF8.self)
        #expect(!text.contains("isRegex"))
        #expect(!text.contains("regexFlags"))
        #expect(!text.contains("mode"))
    }

    /// Pins the vocabulary boundary from the other side: values outside the
    /// contract's enum sets are dropped by the device parser (mirroring the
    /// malformed-shape cases in the contract's own tests), which is exactly
    /// why the encoder's typed inputs and round-trip self-check exist.
    @Test("unknown enum values are rejected by the device parser", arguments: [
        #"{"kind":"bogus.kind"}"#,
        #"{"kind":"throttle.set","profile":"super-fast"}"#,
        #"{"kind":"breakpoint.add","breakpoint":{"id":"a","pattern":"/x","on":"sometimes","enabled":true}}"#,
        #"{"kind":"mock.add","rule":{"id":"a","pattern":"/x","mode":"bogus","enabled":true,"response":{"status":200,"body":""}}}"#,
        #"{"kind":"breakpoint.paused","pauseId":"p1","phase":"both","device":"x","request":{"url":"u","method":"GET","headers":{}}}"#,
        #"{"kind":"breakpoint.paused","pauseId":"p1","phase":"sideways","device":"x","request":{"url":"u","method":"GET","headers":{}}}"#,
    ])
    func unknownEnumValuesAreDropped(_ payloadJSON: String) throws {
        let payload = try #require(try JSONSerialization.jsonObject(with: Data(payloadJSON.utf8)))
        #expect(parseControlCommand(payload) == nil)
    }
}
