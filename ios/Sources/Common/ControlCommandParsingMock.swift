import Foundation

// MARK: - Parsing helpers — mock.add
//
// Split out of `ControlCommandParsing.swift` to keep files under 200 lines.
// `internal` (module-default) visibility — shared with `ControlCommandParsing.swift`.

func asObject(_ v: Any?) -> [String: Any]? {
    v as? [String: Any]
}

/// Validates the subset of `MockResponse` accepted over the wire (no
/// functions — those cannot cross the bridge).
func parseMockResponse(_ v: Any?) -> MockResponse? {
    guard let obj = asObject(v) else { return nil }
    guard let statusNum = obj["status"] as? NSNumber else { return nil }
    let status = statusNum.intValue

    var headers: [String: String] = [:]
    if let rawHeaders = obj["headers"] {
        guard let headerObj = asObject(rawHeaders) else { return nil }
        for (k, v) in headerObj {
            guard let s = v as? String else { return nil }
            headers[k] = s
        }
    }

    let body: String?
    switch obj["body"] {
    case let s as String:
        body = s
    case let arr as [Any]:
        guard let data = try? JSONSerialization.data(withJSONObject: arr),
              let s = String(data: data, encoding: .utf8) else { return nil }
        body = s
    case let d as [String: Any]:
        guard JSONSerialization.isValidJSONObject(d),
              let data = try? JSONSerialization.data(withJSONObject: d),
              let s = String(data: data, encoding: .utf8) else { return nil }
        body = s
    case nil, is NSNull:
        body = nil
    default:
        return nil
    }

    var delay: TimeInterval = 0
    if let rawDelay = obj["delay"] {
        guard let n = rawDelay as? NSNumber else { return nil }
        let ms = n.doubleValue
        guard ms.isFinite, ms >= 0 else { return nil }
        delay = ms / 1000.0
    }

    return MockResponse(status: status, headers: headers, body: body, delay: delay)
}

/// Validates the `MockRuleModify` shape (see `MockRuleModify.swift`) — plain
/// data only, no functions. Matches `parseMockRuleInput`'s style: any
/// malformed sub-field rejects the whole `modify` block (and, via the caller,
/// the whole `mock.add` command) rather than silently dropping just that
/// field. Mirrors `control.ts`'s `parseMockRuleModify` exactly.
func parseMockRuleModify(_ v: Any?) -> MockRuleModify? {
    guard let obj = asObject(v) else { return nil }

    func stringMap(_ key: String) -> [String: String]?? {
        guard let raw = obj[key], !(raw is NSNull) else { return .some(nil) }
        guard let dict = asObject(raw) else { return nil }
        var out: [String: String] = [:]
        for (k, val) in dict {
            guard let s = val as? String else { return nil }
            out[k] = s
        }
        return .some(out)
    }

    func stringArray(_ key: String) -> [String]?? {
        guard let raw = obj[key], !(raw is NSNull) else { return .some(nil) }
        guard let arr = raw as? [Any] else { return nil }
        var out: [String] = []
        for item in arr {
            guard let s = item as? String else { return nil }
            out.append(s)
        }
        return .some(out)
    }

    guard let setRequestHeaders = stringMap("setRequestHeaders") else { return nil }
    guard let removeRequestHeaders = stringArray("removeRequestHeaders") else { return nil }
    guard let setQueryParams = stringMap("setQueryParams") else { return nil }
    guard let removeQueryParams = stringArray("removeQueryParams") else { return nil }
    guard let setResponseHeaders = stringMap("setResponseHeaders") else { return nil }
    guard let removeResponseHeaders = stringArray("removeResponseHeaders") else { return nil }

    var status: Int?
    if let rawStatus = obj["status"], !(rawStatus is NSNull) {
        guard let n = rawStatus as? NSNumber else { return nil }
        status = n.intValue
    }

    var replaceBody: [MockRuleModify.BodyReplacement]?
    if let rawReplace = obj["replaceBody"], !(rawReplace is NSNull) {
        guard let arr = rawReplace as? [Any] else { return nil }
        var out: [MockRuleModify.BodyReplacement] = []
        for item in arr {
            guard let entry = asObject(item),
                  let find = entry["find"] as? String,
                  let replace = entry["replace"] as? String
            else { return nil }
            out.append(MockRuleModify.BodyReplacement(find: find, replace: replace))
        }
        replaceBody = out
    }

    return MockRuleModify(
        setRequestHeaders: setRequestHeaders,
        removeRequestHeaders: removeRequestHeaders,
        setQueryParams: setQueryParams,
        removeQueryParams: removeQueryParams,
        status: status,
        setResponseHeaders: setResponseHeaders,
        removeResponseHeaders: removeResponseHeaders,
        replaceBody: replaceBody
    )
}

/// Validates the `MockFailure` shape — a single required `code` from the
/// fixed vocabulary. Mirrors `control.ts`'s `parseMockFailure`.
func parseMockFailure(_ v: Any?) -> MockFailure? {
    guard let obj = asObject(v) else { return nil }
    guard let codeString = obj["code"] as? String,
          let code = MockFailureCode(rawValue: codeString)
    else { return nil }
    return MockFailure(code: code)
}

/// A non-negative integer count (`skipCount`/`stopAfter`) — rejects negatives,
/// non-finite, non-integer. Mirrors `control.ts`'s `isNonNegativeInt`.
func parseNonNegativeInt(_ v: Any) -> Int? {
    guard let n = v as? NSNumber else { return nil }
    // Reject booleans (NSNumber wraps Bool too) and non-integral doubles.
    if CFGetTypeID(n) == CFBooleanGetTypeID() { return nil }
    let d = n.doubleValue
    guard d.isFinite, d == d.rounded(), d >= 0 else { return nil }
    return n.intValue
}

func parseMockRuleInput(_ v: Any?) -> (id: String, rule: MockRuleInput)? {
    guard let obj = asObject(v) else { return nil }
    guard let id = obj["id"] as? String, isExternalId(id) else { return nil }
    guard let pattern = obj["pattern"] as? String, !pattern.isEmpty else { return nil }

    var method: String?
    if let rawMethod = obj["method"] {
        guard let m = rawMethod as? String else { return nil }
        method = m
    }

    if let rawMode = obj["mode"] {
        guard let mode = rawMode as? String, mode == "mock" || mode == "rewrite" else { return nil }
    }

    guard let enabled = obj["enabled"] as? Bool else { return nil }

    var redirectTo: String?
    if let rawRedirect = obj["redirectTo"], !(rawRedirect is NSNull) {
        guard let s = rawRedirect as? String else { return nil }
        redirectTo = s
    }

    var block = false
    if let rawBlock = obj["block"], !(rawBlock is NSNull) {
        guard let b = rawBlock as? Bool else { return nil }
        block = b
    }

    var modify: MockRuleModify?
    if let rawModify = obj["modify"], !(rawModify is NSNull) {
        guard let m = parseMockRuleModify(rawModify) else { return nil }
        modify = m
    }

    var failure: MockFailure?
    if let rawFailure = obj["failure"], !(rawFailure is NSNull) {
        guard let f = parseMockFailure(rawFailure) else { return nil }
        failure = f
    }

    var skipCount = 0
    if let rawSkip = obj["skipCount"], !(rawSkip is NSNull) {
        guard let n = parseNonNegativeInt(rawSkip) else { return nil }
        skipCount = n
    }

    var stopAfter: Int?
    if let rawStop = obj["stopAfter"], !(rawStop is NSNull) {
        guard let n = parseNonNegativeInt(rawStop) else { return nil }
        stopAfter = n
    }

    guard let response = parseMockResponse(obj["response"]) else { return nil }

    let rule = MockRuleInput(
        pattern: pattern,
        isRegex: false,
        regexFlags: nil,
        method: method,
        response: response,
        enabled: enabled,
        redirectTo: redirectTo,
        block: block,
        modify: modify,
        failure: failure,
        skipCount: skipCount,
        stopAfter: stopAfter
    )
    return (id, rule)
}
