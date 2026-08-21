import Foundation
import JavaScriptCore

/// Builds the deliberately small surface a script sees — `env`, `log`,
/// `vars.set(...)`, and the `request`/`response` it may mutate — and reads
/// back whatever the script left in `request`/`response`/`vars` once it has
/// finished. Filesystem and network access are not filtered out; they are
/// simply never installed — a stock `JSContext` has no `require`, no
/// `fetch`, no `XMLHttpRequest` on its own.
enum ScriptBridge {
    static func install(input: ScriptInput, logs: ScriptLogSink, vars: ScriptVariableSink, into context: JSContext) {
        context.setObject(input.env as NSDictionary, forKeyedSubscript: "env" as NSString)

        let logBlock: @convention(block) (JSValue) -> Void = { value in
            logs.lines.append(value.isString ? value.toString() : (value.toString() ?? "undefined"))
        }
        context.setObject(logBlock, forKeyedSubscript: "log" as NSString)

        // `vars` is a real object with one method, not a bridged
        // `NSMutableDictionary`, so a write is unambiguously a Swift-side
        // append rather than depending on undocumented JSC-to-Foundation
        // property bridging for dot/subscript assignment on a raw
        // dictionary — the same reasoning that made `log` a block, not a
        // magic array.
        let setBlock: @convention(block) (JSValue, JSValue) -> Void = { key, value in
            guard key.isString else { return }
            vars.values[key.toString()] = value.isString ? value.toString() : (value.toString() ?? "undefined")
        }
        let varsObject = JSValue(newObjectIn: context)
        varsObject?.setObject(setBlock, forKeyedSubscript: "set" as NSString)
        context.setObject(varsObject, forKeyedSubscript: "vars" as NSString)

        if let request = input.request {
            context.setObject(dictionary(from: request), forKeyedSubscript: "request" as NSString)
        }
        if let response = input.response {
            context.setObject(dictionary(from: response), forKeyedSubscript: "response" as NSString)
        }
    }

    static func readRequest(from context: JSContext) -> ScriptRequestContext? {
        guard let value = context.objectForKeyedSubscript("request"), value.isObject,
              let method = value.forProperty("method")?.toString(),
              let url = value.forProperty("url")?.toString()
        else { return nil }
        return ScriptRequestContext(
            method: method,
            url: url,
            headers: stringDictionary(value.forProperty("headers")),
            body: stringOrNil(value.forProperty("body"))
        )
    }

    static func readResponse(from context: JSContext) -> ScriptResponseContext? {
        guard let value = context.objectForKeyedSubscript("response"), value.isObject,
              let status = value.forProperty("status")?.toInt32()
        else { return nil }
        return ScriptResponseContext(
            status: Int(status),
            headers: stringDictionary(value.forProperty("headers")),
            body: stringOrNil(value.forProperty("body"))
        )
    }

    private static func dictionary(from request: ScriptRequestContext) -> NSDictionary {
        [
            "method": request.method,
            "url": request.url,
            "headers": request.headers,
            "body": request.body ?? NSNull(),
        ] as NSDictionary
    }

    private static func dictionary(from response: ScriptResponseContext) -> NSDictionary {
        [
            "status": response.status,
            "headers": response.headers,
            "body": response.body ?? NSNull(),
        ] as NSDictionary
    }

    private static func stringOrNil(_ value: JSValue?) -> String? {
        guard let value, !value.isUndefined, !value.isNull else { return nil }
        return value.toString()
    }

    private static func stringDictionary(_ value: JSValue?) -> [String: String] {
        guard let value, let raw = value.toDictionary() as? [String: Any] else { return [:] }
        var result: [String: String] = [:]
        for (key, item) in raw {
            result[key] = (item as? String) ?? String(describing: item)
        }
        return result
    }
}

/// Collects `log(...)` calls made during one script's execution. Created
/// fresh per `run` and owned exclusively by the dedicated queue that one
/// call executes on; never shared across scripts.
final class ScriptLogSink {
    var lines: [String] = []
}

/// Collects `vars.set(...)` calls made during one script's execution. Same
/// lifetime and ownership as `ScriptLogSink` — fresh per `run`, never
/// shared.
final class ScriptVariableSink {
    var values: [String: String] = [:]
}
