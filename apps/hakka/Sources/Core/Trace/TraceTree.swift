import HakkaCommon

/// One bar in a trace waterfall — either a request hop or a framework span.
/// Swift mirror of `TraceBar` in `packages/hakka-core/src/query/traceTree.ts`.
public struct TraceBar: Sendable, Identifiable, Equatable {
    public enum Kind: Sendable, Equatable { case request, span }

    public let kind: Kind
    public let id: String
    /// Skew-corrected, still epoch-millisecond timeline position — see
    /// `TraceTree.assemble`'s doc for what "corrected" means here.
    public let startTime: Int64
    public let endTime: Int64
    public let depth: Int
    public let label: String
    public let runtime: RequestRuntime
    public let verbosity: SpanVerbosity?
    public let request: NetworkRequest?
    public let span: FrameworkSpan?
    /// True when this bar's raw `startTime` was clamped forward to its
    /// causal parent's start because the emitting machine's clock ran ahead
    /// of the parent's — see `TraceTree.assemble`.
    public let clockCorrected: Bool
}

/// One trace's assembled, orderable bar list plus its rendered time bounds.
public struct TraceTree: Sendable, Equatable {
    public let bars: [TraceBar]
    public let t0: Int64
    public let t1: Int64
}

extension TraceTree {
    /// Assemble one trace's requests + spans into an ordered, depth- and
    /// clock-corrected bar list, sorted by (corrected) `startTime`.
    ///
    /// **Clock skew.** Requests and spans arrive from different machines
    /// (a phone and a laptop running `hakka-node`) with unsynchronised
    /// clocks — there is no NTP handshake in a dev-loop tool, so absolute
    /// wall-clock agreement cannot be assumed. Full clock-offset estimation
    /// (e.g. treating request RTT as a symmetric-latency probe, à la NTP)
    /// is more machinery than a dev tool waterfall needs and would still be
    /// an estimate. Instead this assembler enforces one simpler, weaker but
    /// unconditionally true invariant: **an effect cannot start before its
    /// cause on the rendered timeline.** A span's cause is its parent span,
    /// or (for a root span) the request whose `correlationId` equals the
    /// trace id. If a bar's raw `startTime` precedes its cause's, it is
    /// clamped forward to the cause's start — its measured *duration* is
    /// preserved (only the start moves), and `clockCorrected` is set so the
    /// UI can mark it. This fixes the one failure mode that actually
    /// confuses a developer (a server span appearing to start before the
    /// client request that triggered it) without pretending to know the
    /// true skew magnitude for bars that don't exhibit it.
    ///
    /// Root reference: the request whose own `id` equals the trace id (the
    /// hop that originated the trace) when present, else the
    /// earliest-starting request, else (spans only, no request yet) the
    /// earliest root span. Every other bar's clamp target derives from
    /// this transitively via the parent chain.
    public static func assemble(
        requests: [NetworkRequest],
        spans: [FrameworkSpan],
        verbose: Bool = false
    ) -> TraceTree {
        let isVisible: (FrameworkSpan) -> Bool = { verbose || $0.verbosity == .primary }
        let visibleSpans = spans.filter(isVisible)
        let depths = spanDepths(spans, isVisible: isVisible)
        let spanByID = Dictionary(uniqueKeysWithValues: spans.map { ($0.id, $0) })

        // Causal-start lookup: a span's cause start-time is its parent's
        // (already-corrected) start, or its trace's root request start when
        // it has no resolvable parent.
        var correctedSpanStart: [String: Int64] = [:]
        let rootRequestStart = requests.min { $0.startTime < $1.startTime }?.startTime

        func causeStart(for span: FrameworkSpan) -> Int64? {
            if let parentID = span.parentId, let parent = spanByID[parentID] {
                return resolvedStart(of: parent)
            }
            return rootRequestStart
        }

        func resolvedStart(of span: FrameworkSpan) -> Int64 {
            if let cached = correctedSpanStart[span.id] { return cached }
            let cause = causeStart(for: span)
            let corrected = cause.map { max(span.startTime, $0) } ?? span.startTime
            correctedSpanStart[span.id] = corrected
            return corrected
        }

        let requestBars: [TraceBar] = requests.map { req in
            TraceBar(
                kind: .request,
                id: req.id,
                startTime: req.startTime,
                endTime: hopEnd(req),
                depth: 0,
                label: requestLabel(req),
                runtime: req.runtime ?? .client,
                verbosity: nil,
                request: req,
                span: nil,
                clockCorrected: false
            )
        }

        let spanBars: [TraceBar] = visibleSpans.map { span in
            let corrected = resolvedStart(of: span)
            let duration = max(span.endTime - span.startTime, 0)
            return TraceBar(
                kind: .span,
                id: span.id,
                startTime: corrected,
                endTime: corrected + duration,
                depth: depths[span.id] ?? 0,
                label: span.name,
                runtime: span.runtime,
                verbosity: span.verbosity,
                request: nil,
                span: span,
                clockCorrected: corrected != span.startTime
            )
        }

        let bars = (requestBars + spanBars).sorted { $0.startTime < $1.startTime }
        guard !bars.isEmpty else { return TraceTree(bars: [], t0: 0, t1: 0) }

        let t0 = bars.map(\.startTime).min() ?? 0
        let t1 = bars.map(\.endTime).max() ?? 0
        return TraceTree(bars: bars, t0: t0, t1: max(t1, t0 + 1))
    }
}

/// End of a request on the wall clock — `duration`-derived when `endTime`
/// isn't separately tracked (Swift's `NetworkRequest` has no `endTime`
/// field; TS's does), else start + duration, else start (still pending).
private func hopEnd(_ req: NetworkRequest) -> Int64 {
    if let duration = req.duration { return req.startTime + duration }
    return req.startTime
}

private func requestLabel(_ req: NetworkRequest) -> String {
    guard let schemeRange = req.url.range(of: "://") else { return req.url }
    let afterScheme = req.url[schemeRange.upperBound...]
    guard let pathStart = afterScheme.firstIndex(of: "/") else { return "/" }
    let path = String(afterScheme[pathStart...])
    return path.isEmpty ? "/" : path
}

/// Depth of each span within its trace, walking the `parentId` chain
/// against the FULL span set so a visible span nests under its nearest
/// VISIBLE ancestor rather than collapsing to depth 0 — mirrors
/// `computeSpanDepths` in `traceTree.ts` exactly, including the cycle guard.
private func spanDepths(_ spans: [FrameworkSpan], isVisible: (FrameworkSpan) -> Bool) -> [String: Int] {
    let byID = Dictionary(uniqueKeysWithValues: spans.map { ($0.id, $0) })
    var depths: [String: Int] = [:]

    func depth(of span: FrameworkSpan, visiting: inout Set<String>) -> Int {
        if let cached = depths[span.id] { return cached }
        guard let parentID = span.parentId, !visiting.contains(span.id), let parent = byID[parentID] else {
            depths[span.id] = 0
            return 0
        }
        visiting.insert(span.id)
        let parentDepth = depth(of: parent, visiting: &visiting)
        visiting.remove(span.id)
        if let already = depths[span.id] { return already }
        let result = isVisible(parent) ? parentDepth + 1 : parentDepth
        depths[span.id] = result
        return result
    }

    for span in spans {
        var visiting = Set<String>()
        _ = depth(of: span, visiting: &visiting)
    }
    return depths
}
