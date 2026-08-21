import Foundation

/// Which part of a request a search token matches against.
public enum TrafficSearchScope: String, Sendable, Equatable, CaseIterable {
    case url, header, body, all
}

/// How `TrafficSearchToken.value` is interpreted.
public enum TrafficSearchMode: String, Sendable, Equatable, CaseIterable {
    case substring, wildcard, regex
}

public enum TrafficSortField: String, Sendable, Equatable, CaseIterable {
    case time, duration, size, status
}

public enum TrafficSortOrder: String, Sendable, Equatable, CaseIterable {
    case asc, desc
}

/// A single parsed search token. Mirrors `SearchToken` in
/// `packages/hakka-core/src/query/types.ts`.
public struct TrafficSearchToken: Sendable, Equatable {
    public var scope: TrafficSearchScope
    public var mode: TrafficSearchMode
    public var value: String
    /// When true the token must NOT match for the request to pass.
    public var negate: Bool

    public init(scope: TrafficSearchScope = .all, mode: TrafficSearchMode = .substring, value: String, negate: Bool = false) {
        self.scope = scope
        self.mode = mode
        self.value = value
        self.negate = negate
    }
}

/// A structured filter/sort request over a `TrafficStore` buffer. Mirrors
/// the TS `AdvancedQuery` (`packages/hakka-core/src/query/types.ts`) for the
/// subset implemented here — see `TrafficQueryCompiler`'s doc comment for
/// the deliberate divergences (no `runtime`, `host` added).
///
/// This is the compiled/structured form, equivalent to what the TS engine's
/// `compileQuery` receives — turning raw search-bar text into this shape
/// (the `parser.ts` half) is left to the UI layer, same as upstream.
public struct TrafficQuery: Sendable, Equatable {
    public var tokens: [TrafficSearchToken]
    /// Status-class DSL string ("2xx", ">=400", "200..299", …) — see `TrafficStatusDsl`.
    public var statusDsl: String?
    public var method: String?
    /// Substring match against the response Content-Type header.
    public var contentType: String?
    /// Substring match against the request URL's host.
    public var host: String?
    /// Substring match against the connected-device label ("Device 1", …)
    /// that produced the request. Unlike every other field here, this has
    /// no meaning to `TrafficQueryCompiler` — device identity lives only in
    /// the desktop app's `DeviceLabelIndex`, never on `NetworkRequest` — so
    /// `TrafficModel` applies this term itself. It stays part of the parsed
    /// query anyway so `device:` participates in the same grammar (quoting,
    /// negation) as every other filter instead of needing a bespoke parser.
    public var device: String?
    /// When true, `method`/`contentType`/`host`/`device` must NOT match.
    /// Separate flags rather than a negate on the whole query so
    /// `-method:GET type:json` means what it reads as.
    public var methodNegate: Bool
    public var contentTypeNegate: Bool
    public var hostNegate: Bool
    public var deviceNegate: Bool
    /// When true, the status range must NOT contain the request's status.
    public var statusNegate: Bool
    public var durationMin: Int64?
    public var durationMax: Int64?
    public var sizeMin: Int64?
    public var sizeMax: Int64?
    public var sort: TrafficSortField?
    public var order: TrafficSortOrder

    public init(
        tokens: [TrafficSearchToken] = [],
        statusDsl: String? = nil,
        method: String? = nil,
        contentType: String? = nil,
        host: String? = nil,
        device: String? = nil,
        methodNegate: Bool = false,
        contentTypeNegate: Bool = false,
        hostNegate: Bool = false,
        deviceNegate: Bool = false,
        statusNegate: Bool = false,
        durationMin: Int64? = nil,
        durationMax: Int64? = nil,
        sizeMin: Int64? = nil,
        sizeMax: Int64? = nil,
        sort: TrafficSortField? = nil,
        order: TrafficSortOrder = .desc,
    ) {
        self.tokens = tokens
        self.statusDsl = statusDsl
        self.method = method
        self.contentType = contentType
        self.host = host
        self.device = device
        self.methodNegate = methodNegate
        self.contentTypeNegate = contentTypeNegate
        self.hostNegate = hostNegate
        self.deviceNegate = deviceNegate
        self.statusNegate = statusNegate
        self.durationMin = durationMin
        self.durationMax = durationMax
        self.sizeMin = sizeMin
        self.sizeMax = sizeMax
        self.sort = sort
        self.order = order
    }
}

/// Parses the status-class DSL into an inclusive range. Grammar mirrors
/// `parseStatusDsl` in `packages/hakka-core/src/query/parser.ts` exactly —
/// keep both in sync if the DSL changes. Forms: `"2xx"`, `"200..299"`,
/// `"200..<300"`, `">=400"`, `">400"`, `"<=404"`, `"<500"`, `"404"`.
public enum TrafficStatusDsl {
    public static func parse(_ dsl: String) -> ClosedRange<Int>? {
        let s = dsl.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty else { return nil }

        if let m = s.wholeMatch(of: /([1-5])[xX]{2}/) {
            let base = (Int(m.1) ?? 0) * 100
            return base ... (base + 99)
        }
        if let m = s.wholeMatch(of: /(\d{3})\.\.<(\d{3})/), let lo = Int(m.1), let hiExclusive = Int(m.2) {
            let hi = hiExclusive - 1
            guard lo <= hi else { return nil }
            return lo ... hi
        }
        if let m = s.wholeMatch(of: /(\d{3})\.\.(\d{3})/), let lo = Int(m.1), let hi = Int(m.2) {
            guard lo <= hi else { return nil }
            return lo ... hi
        }
        if let m = s.wholeMatch(of: /(>=?)(\d{3})/), let val = Int(m.2) {
            let lo = m.1 == ">=" ? val : val + 1
            guard lo <= 599 else { return nil }
            return lo ... 599
        }
        if let m = s.wholeMatch(of: /(<=?)(\d{3})/), let val = Int(m.2) {
            let hi = m.1 == "<=" ? val : val - 1
            guard hi >= 100 else { return nil }
            return 100 ... hi
        }
        if let m = s.wholeMatch(of: /(\d{3})/), let code = Int(m.1) {
            return code ... code
        }
        return nil
    }
}
