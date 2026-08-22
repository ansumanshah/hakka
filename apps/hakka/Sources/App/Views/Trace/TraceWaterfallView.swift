import HakkaCommon
import HakkaCore
import SwiftUI

/// One trace's cross-target timeline — the screen ADR 0001's whole product
/// argument rests on: a mobile hop, the server span tree it caused, and
/// where the time actually went, on one axis. Sibling to
/// `TimingWaterfallPlan`'s single-request phase bars, but this one spans
/// MANY records across targets instead of one record's own phases.
struct TraceWaterfallView: View {
    let trace: Trace
    var onSelectRequest: (String) -> Void = { _ in }

    @State private var verbose = false

    private var tree: TraceTree { trace.tree(verbose: verbose) }
    private var span: Double { max(Double(tree.t1 - tree.t0), 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack {
                legend
                Spacer()
                Toggle("Verbose", isOn: $verbose)
                    .toggleStyle(.checkbox)
                    .font(.caption)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    ForEach(tree.bars) { bar in
                        row(for: bar)
                    }
                }
            }
        }
        .padding(Spacing.lg)
    }

    private var legend: some View {
        HStack(spacing: Spacing.md) {
            ForEach(Array(trace.participantRuntimes).sorted(by: { $0.rawValue < $1.rawValue }), id: \.self) { runtime in
                Label(runtime.rawValue, systemImage: "circle.fill")
                    .labelStyle(.titleAndIcon)
                    .font(.caption2)
                    .foregroundStyle(Fmt.runtimeColor(runtime))
            }
        }
    }

    private func row(for bar: TraceBar) -> some View {
        let offset = (Double(bar.startTime) - Double(tree.t0)) / span
        let width = max((Double(bar.endTime) - Double(bar.startTime)) / span, 0.02)
        return HStack(spacing: Spacing.sm) {
            Text(name(for: bar))
                .font(.caption)
                .lineLimit(1)
                .frame(width: 220, alignment: .leading)
                .padding(.leading, CGFloat(bar.depth) * 12)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(barColor(for: bar))
                        .frame(width: max(geo.size.width * width, 3))
                        .offset(x: geo.size.width * offset)
                }
            }
            .frame(height: 14)  // ui-token-check-ignore: waterfall bar height
            Text(duration(for: bar))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(width: 56, alignment: .trailing)
        }
        .opacity(bar.verbosity == .verbose ? 0.6 : 1)
        .contentShape(Rectangle())
        .onTapGesture {
            if bar.kind == .request, let request = bar.request {
                onSelectRequest(request.id)
            }
        }
        .help(bar.clockCorrected ? "\(name(for: bar)) — start time corrected for clock skew against its cause" : name(for: bar))
    }

    private func name(for bar: TraceBar) -> String {
        guard bar.kind == .request, let request = bar.request else { return bar.label }
        return "\(request.method.rawValue) \(bar.label)"
    }

    private func duration(for bar: TraceBar) -> String {
        if bar.kind == .request { return Fmt.duration(bar.request?.duration) }
        return Fmt.duration(bar.endTime - bar.startTime)
    }

    private func barColor(for bar: TraceBar) -> Color {
        if bar.kind == .request, let request = bar.request, request.error != nil || (request.status ?? 0) >= 500 {
            return ThemeTokens.Status.error
        }
        if bar.kind == .request, let status = bar.request?.status, status >= 400 {
            return ThemeTokens.Status.warning
        }
        return Fmt.runtimeColor(bar.runtime)
    }
}
