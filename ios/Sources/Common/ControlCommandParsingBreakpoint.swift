import Foundation

// MARK: - Parsing helpers — breakpoint.add / .paused / .resume / .abort
//
// Split out of `ControlCommandParsing.swift` to keep files under 200 lines.
// `internal` (module-default) visibility — shared with `ControlCommandParsing.swift`.

func parseBreakpointInput(_ v: Any?) -> (id: String, breakpoint: BreakpointInput)? {
    guard let obj = asObject(v) else { return nil }
    guard let id = obj["id"] as? String, isExternalId(id) else { return nil }
    guard let pattern = obj["pattern"] as? String, !pattern.isEmpty else { return nil }

    var method: String?
    if let rawMethod = obj["method"] {
        guard let m = rawMethod as? String else { return nil }
        method = m
    }

    var phase: BreakpointPhase = .request
    if let rawOn = obj["on"] {
        guard let on = rawOn as? String, breakpointPhaseValues.contains(on),
              let parsedPhase = BreakpointPhase(rawValue: on) else { return nil }
        phase = parsedPhase
    }

    guard let enabled = obj["enabled"] as? Bool else { return nil }

    let breakpoint = BreakpointInput(pattern: pattern, method: method, on: phase, enabled: enabled, id: id)
    return (id, breakpoint)
}

/// Validates `[String: String]` headers — every value must actually be a string.
func parseHeaders(_ v: Any?) -> [String: String]? {
    guard let obj = asObject(v) else { return nil }
    var out: [String: String] = [:]
    for (k, val) in obj {
        guard let s = val as? String else { return nil }
        out[k] = s
    }
    return out
}

func parseBreakpointPausedRequestSnapshot(_ v: Any?) -> BreakpointPausedRequestSnapshot? {
    guard let obj = asObject(v) else { return nil }
    guard let url = obj["url"] as? String, !url.isEmpty else { return nil }
    guard let method = obj["method"] as? String, !method.isEmpty else { return nil }
    guard let headers = parseHeaders(obj["headers"]) else { return nil }

    var body: String?
    if let rawBody = obj["body"], !(rawBody is NSNull) {
        guard let s = rawBody as? String else { return nil }
        body = s
    }

    return BreakpointPausedRequestSnapshot(url: url, method: method, headers: headers, body: body)
}

/// `response.body` is required (see `BreakpointWireEdits.swift`) — a missing
/// or non-string body is malformed, not an omitted-optional field.
func parseBreakpointPausedResponseSnapshot(_ v: Any?) -> BreakpointPausedResponseSnapshot? {
    guard let obj = asObject(v) else { return nil }
    guard let statusNum = obj["status"] as? NSNumber else { return nil }
    guard let headers = parseHeaders(obj["headers"]) else { return nil }
    guard let body = obj["body"] as? String else { return nil }
    return BreakpointPausedResponseSnapshot(status: statusNum.intValue, headers: headers, body: body)
}

func parseBreakpointRequestEdits(_ v: Any?) -> BreakpointRequestEdits? {
    guard let obj = asObject(v) else { return nil }

    var url: String?
    if let raw = obj["url"], !(raw is NSNull) {
        guard let s = raw as? String else { return nil }
        url = s
    }
    var method: String?
    if let raw = obj["method"], !(raw is NSNull) {
        guard let s = raw as? String else { return nil }
        method = s
    }
    var headers: [String: String]?
    if let raw = obj["headers"], !(raw is NSNull) {
        guard let h = parseHeaders(raw) else { return nil }
        headers = h
    }
    var body: String?
    if let raw = obj["body"], !(raw is NSNull) {
        guard let s = raw as? String else { return nil }
        body = s
    }

    return BreakpointRequestEdits(url: url, method: method, headers: headers, body: body)
}

func parseBreakpointResponseEdits(_ v: Any?) -> BreakpointResponseEdits? {
    guard let obj = asObject(v) else { return nil }

    var status: Int?
    if let raw = obj["status"], !(raw is NSNull) {
        guard let n = raw as? NSNumber else { return nil }
        status = n.intValue
    }
    var headers: [String: String]?
    if let raw = obj["headers"], !(raw is NSNull) {
        guard let h = parseHeaders(raw) else { return nil }
        headers = h
    }
    var body: String?
    if let raw = obj["body"], !(raw is NSNull) {
        guard let s = raw as? String else { return nil }
        body = s
    }

    return BreakpointResponseEdits(status: status, headers: headers, body: body)
}
