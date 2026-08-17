#if canImport(UIKit)
import SwiftUI
import HakkaCommon
import HakkaNetwork
import HakkaPerformance

// MARK: - DashboardView: Domain / Method / Slowest / Duration / Size
//
// The bottom stack of the "Detailed metrics" disclosure — per-host and
// per-method breakdowns, the slowest-request list, and the duration/size
// summary cards. Backing data (`domainStats`, `methodCounts`, ...) lives in
// `DashboardViewMetrics.swift`.

extension DashboardView {
    // MARK: - Domain Breakdown

    var domainSection: some View {
        let domains = domainStats
        return Group {
            if !domains.isEmpty {
                VStack(alignment: .leading, spacing: Theme.s8) {
                    label("Domains")
                    ForEach(domains, id: \.host) { entry in
                        HStack(spacing: Theme.s8) {
                            Text(entry.host)
                                .font(.caption)
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)

                            Text("\(entry.count)")
                                .font(.caption.monospacedDigit().weight(.medium))
                                .foregroundStyle(Theme.textSecondary)

                            Text(Fmt.formatDuration(entry.avgMs))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(entry.avgMs > 1000 ? Theme.warning : Theme.textTertiary)
                                .frame(width: 50, alignment: .trailing)

                            if entry.errorCount > 0 {
                                Text("\(entry.errorCount) err")
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(Theme.error)
                            }
                        }
                        .padding(.vertical, Theme.s2)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            UIPasteboard.general.string = entry.host
                            Haptics.light()
                        }
                        .contextMenu {
                            Button {
                                UIPasteboard.general.string = entry.host
                                Haptics.light()
                            } label: {
                                Label("Copy Domain", systemImage: "doc.on.doc")
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Method Breakdown

    var methodSection: some View {
        let breakdown = methodCounts
        return Group {
            if !breakdown.isEmpty {
                VStack(alignment: .leading, spacing: Theme.s8) {
                    label("Methods")
                    ForEach(breakdown, id: \.method) { entry in
                        HStack {
                            Text(entry.method)
                                .font(.caption.monospaced().weight(.medium))
                                .foregroundStyle(Theme.text)
                                .frame(width: 60, alignment: .leading)

                            GeometryReader { geo in
                                let frac = requests.count > 0
                                    ? CGFloat(entry.count) / CGFloat(requests.count) : 0
                                RoundedRectangle(cornerRadius: Theme.radiusS)
                                    .fill(Theme.methodColor(for: HttpMethod(rawString: entry.method)))
                                    .frame(width: max(4, geo.size.width * frac))
                            }
                            .frame(height: 14)  // ui-token-check-ignore: chart bar or plot-area geometry

                            Text("\(entry.count)")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(Theme.textSecondary)
                                .frame(width: HakkaMetrics.ControlHeight.icon, alignment: .trailing)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Slowest Requests

    var slowestSection: some View {
        let slowest = requests
            .filter { $0.duration != nil }
            .sorted { ($0.duration ?? 0) > ($1.duration ?? 0) }
            .prefix(5)

        return Group {
            if !slowest.isEmpty {
                VStack(alignment: .leading, spacing: Theme.s8) {
                    label("Slowest")
                    ForEach(Array(slowest), id: \.id) { req in
                        Button {
                            selectedRequest = req
                        } label: {
                            HStack(spacing: Theme.s6) {
                                MethodBadge(method: req.method)
                                Text(URL(string: req.url)?.path ?? req.url)
                                    .font(.caption)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Spacer()
                                Text(Fmt.formatDuration(req.duration ?? 0))
                                    .font(.caption.monospacedDigit().weight(.medium))
                                    .foregroundStyle(req.duration ?? 0 > 1000 ? Theme.warning : Theme.textSecondary)
                                Image(systemName: "chevron.right")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(Theme.textTertiary)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button {
                                selectedRequest = req
                            } label: {
                                Label("Open Request", systemImage: "doc.text.magnifyingglass")
                            }
                            Button {
                                UIPasteboard.general.string = req.url
                                Haptics.light()
                            } label: {
                                Label("Copy URL", systemImage: "link")
                            }
                            Button {
                                UIPasteboard.general.string = CurlExporter.export(req)
                                Haptics.light()
                            } label: {
                                Label("Copy cURL", systemImage: "terminal")
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Duration

    var durationSection: some View {
        let durations = requests.compactMap { $0.duration }
        return Group {
            if !durations.isEmpty {
                VStack(alignment: .leading, spacing: Theme.s8) {
                    label("Duration")
                    HStack(spacing: Theme.s8) {
                        card("Avg", Fmt.formatDuration(durations.reduce(0, +) / Int64(durations.count)), Theme.info)
                        card("Min", Fmt.formatDuration(durations.min() ?? 0), Theme.success)
                        card("Max", Fmt.formatDuration(durations.max() ?? 0), Theme.warning)
                    }
                    if let p95 = networkP95 {
                        HStack(spacing: Theme.s8) {
                            card("p95", Fmt.formatDuration(p95), performanceColor(p95))
                        }
                    }
                }
            }
        }
    }

    // MARK: - Size

    var sizeSection: some View {
        let total = requests.reduce(Int64(0)) { $0 + $1.responseBodySize }
        let sizes = requests.filter { $0.responseBodySize > 0 }.map { $0.responseBodySize }
        return Group {
            if total > 0 {
                VStack(alignment: .leading, spacing: Theme.s8) {
                    label("Response Size")
                    HStack(spacing: Theme.s8) {
                        card("Total", Fmt.formatBytes(total), Theme.methodPut)
                        if !sizes.isEmpty {
                            card("Avg", Fmt.formatBytes(total / Int64(sizes.count)), Theme.info)
                        }
                    }
                }
            }
        }
    }
}
#endif // canImport(UIKit)
