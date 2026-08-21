import Foundation
import Testing
@testable import HakkaCore

/// Direct tests of the JavaScriptCore implementation itself, beyond what
/// the generic conformance harness checks — sandbox-escape attempts and the
/// exact published global surface are inherently JSC-specific, not
/// portable to a hypothetical other `ScriptRuntime`.
@Suite("JavaScriptCoreScriptRuntime")
struct JavaScriptCoreScriptRuntimeTests {
    @Test("request and response mutation round-trips through the script")
    func requestResponseMutation() async throws {
        let runtime = JavaScriptCoreScriptRuntime()
        let output = try await runtime.run(ScriptInput(
            source: """
            request.headers['x-signed'] = 'yes';
            response.status = 204;
            response.body = 'replaced';
            """,
            request: ScriptRequestContext(method: "GET", url: "https://example.com"),
            response: ScriptResponseContext(status: 200, body: "original")
        ))
        #expect(output.request?.headers["x-signed"] == "yes")
        #expect(output.response?.status == 204)
        #expect(output.response?.body == "replaced")
    }

    @Test("env is readable but scoped to one call")
    func envIsReadable() async throws {
        let runtime = JavaScriptCoreScriptRuntime()
        let output = try await runtime.run(ScriptInput(source: "log(env.token);", env: ["token": "abc123"]))
        #expect(output.logs == ["abc123"])
    }

    @Test("a synthesized-function escape via constructor.constructor grants no new capability")
    func constructorConstructorEscapeGrantsNoNewCapability() async throws {
        let runtime = JavaScriptCoreScriptRuntime()
        let output = try await runtime.run(ScriptInput(source: """
        var synthesized = (function(){}).constructor('return this')();
        log(typeof synthesized.require);
        log(typeof synthesized.fetch);
        log(String(synthesized === this));
        """))
        #expect(output.logs == ["undefined", "undefined", "true"])
    }

    @Test("the prototype chain of a bridged function exposes nothing beyond standard JS built-ins")
    func prototypeChainExposesNothingExtra() async throws {
        let runtime = JavaScriptCoreScriptRuntime()
        let output = try await runtime.run(ScriptInput(source: """
        var proto = Object.getPrototypeOf(log);
        log(Object.getOwnPropertyNames(proto).sort().join(','));
        log(String(Object.getPrototypeOf(proto) === Object.prototype));
        """))
        #expect(output.logs[0] == "apply,arguments,bind,call,caller,constructor,length,name,toString")
        #expect(output.logs[1] == "true")
    }

    /// JavaScriptCore's own baseline global names on this toolchain, with
    /// nothing of ours. Captured by hand at development time from a fresh
    /// `JSContext`. If a future JSC ships something new, the next check
    /// (against our published surface) fails the build rather than quietly
    /// widening what a script can reach — that is the point of this test,
    /// not a bug to "fix" by adding names to this list without auditing them.
    private static let jscBaselineGlobals: Set<String> = [
        "AggregateError", "Array", "ArrayBuffer", "Atomics", "BigInt", "BigInt64Array",
        "BigUint64Array", "Boolean", "DataView", "Date", "Error", "EvalError",
        "FinalizationRegistry", "Float16Array", "Float32Array", "Float64Array", "Function",
        "Infinity", "Int16Array", "Int32Array", "Int8Array", "Intl", "Iterator", "JSON", "Map",
        "Math", "NaN", "Number", "Object", "Promise", "Proxy", "RangeError", "ReferenceError",
        "Reflect", "RegExp", "Set", "String", "Symbol", "SyntaxError", "TypeError", "URIError",
        "Uint16Array", "Uint32Array", "Uint8Array", "Uint8ClampedArray", "WeakMap", "WeakRef",
        "WeakSet", "WebAssembly", "console", "decodeURI", "decodeURIComponent", "encodeURI",
        "encodeURIComponent", "escape", "eval", "globalThis", "isFinite", "isNaN", "parseFloat",
        "parseInt", "undefined", "unescape",
    ]

    /// Exactly the names `ScriptBridge` adds. If this test starts failing
    /// because a script can see something not in `jscBaselineGlobals ∪`
    /// this set, either the bridge grew unintentionally or JSC's own
    /// surface widened — both are things this test exists to catch.
    private static let publishedGlobals: Set<String> = ["env", "log", "request", "response", "vars"]

    @Test("the global object surface is exactly the JSC baseline plus what we publish")
    func globalObjectSurfaceIsExact() async throws {
        let runtime = JavaScriptCoreScriptRuntime()
        let output = try await runtime.run(ScriptInput(
            source: "log(Object.getOwnPropertyNames(this).sort().join(','));",
            env: [:],
            request: ScriptRequestContext(method: "GET", url: "https://example.com"),
            response: ScriptResponseContext(status: 200)
        ))
        let actual = Set(output.logs[0].split(separator: ",").map(String.init))
        let expected = Self.jscBaselineGlobals.union(Self.publishedGlobals)
        #expect(actual == expected, "unexpected globals: \(actual.symmetricDifference(expected))")
    }
}
