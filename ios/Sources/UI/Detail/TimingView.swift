#if canImport(UIKit)
import SwiftUI
import HakkaCommon
import HakkaNetwork

// MARK: - TimingView

/// Timing breakdown with grouped sections:
///   Sent/Received → Connection (DNS, TCP, TLS) → Response (Waiting, Download)
struct TimingView: View {
    let request: NetworkRequest

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.s12) {
            transferCards
            timingSections
        }
        .padding(.vertical, Theme.s4)
    }

    // MARK: - Sent / Received cards

    private var transferCards: some View {
        HStack(spacing: Theme.s8) {
            transferCard(
                icon: "arrow.up.circle.fill",
                title: "Sent",
                headerSize: estimateHeaderSize(request.requestHeaders),
                bodySize: request.requestBodySize,
                color: Theme.info
            )
            transferCard(
                icon: "arrow.down.circle.fill",
                title: "Received",
                headerSize: estimateHeaderSize(request.responseHeaders),
                bodySize: request.responseBodySize,
                color: Theme.success
            )
        }
    }

    private func transferCard(icon: String, title: String, headerSize: Int64,
                               bodySize: Int64, color: Color) -> some View {
        VStack(spacing: Theme.s4) {
            HStack(spacing: Theme.s4) {
                Image(systemName: icon)
                    .foregroundStyle(color)
                    .font(.caption)
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.text)
            }
            Text(Fmt.formatBytes(headerSize + bodySize))
                .font(.subheadline.monospacedDigit().weight(.bold))
                .foregroundStyle(color)

            VStack(spacing: Theme.s2) {
                sizeRow("Headers", headerSize)
                sizeRow("Body", bodySize)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.s8)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusL))
    }

    private func sizeRow(_ label: String, _ bytes: Int64) -> some View {
        HStack {
            Text(label)
                .font(.caption2)
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(Fmt.formatBytes(bytes))
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
        }
        .padding(.horizontal, Theme.s8)
    }

    // MARK: - Timing sections

    @ViewBuilder
    private var timingSections: some View {
        let phases = buildPhases()
        let totalMs = phases.last.map { $0.endMs } ?? (request.duration ?? 0)

        if !phases.isEmpty {
            // Connection section (DNS, TCP, TLS)
            let connPhases = phases.filter { ["DNS Lookup", "TCP Handshake", "TLS Handshake"].contains($0.label) }
            if !connPhases.isEmpty {
                timingSection("Connection", phases: connPhases, totalMs: totalMs)
            }

            // Response section (Waiting, Download, Remaining)
            let respPhases = phases.filter { ["Waiting (TTFB)", "Content Download", "Remaining"].contains($0.label) }
            if !respPhases.isEmpty {
                timingSection("Response", phases: respPhases, totalMs: totalMs)
            }

            if let total = request.duration {
                HStack {
                    Text("Total")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.text)
                    Spacer()
                    Text(Fmt.formatDuration(total))
                        .font(.caption.monospacedDigit().weight(.bold))
                        .foregroundStyle(Theme.text)
                }
                .padding(.vertical, Theme.s4)
            }
        }
    }

    private func timingSection(_ title: String, phases: [TimingPhase], totalMs: Int64) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.text)
                .padding(.bottom, Theme.s4)

            ForEach(phases, id: \.label) { phase in
                TimingPhaseRow(phase: phase, totalMs: totalMs)
            }
        }
        .padding(Theme.s8)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusL))
    }

    // MARK: - Build phases

    private func buildPhases() -> [TimingPhase] {
        var result: [TimingPhase] = []
        var offset: Int64 = 0

        func add(_ label: String, _ ms: Int64?, _ color: Color) {
            guard let ms, ms > 0 else { return }
            result.append(TimingPhase(label: label, ms: ms,
                                       startMs: offset, endMs: offset + ms, color: color))
            offset += ms
        }

        add("DNS Lookup",       request.dnsMs,      Theme.timingDNS)
        add("TCP Handshake",    request.connectMs,   Theme.timingTCP)
        add("TLS Handshake",    request.tlsMs,       Theme.timingTLS)
        add("Waiting (TTFB)",   request.ttfbMs,      Theme.timingTTFB)
        add("Content Download", request.downloadMs,  Theme.timingDownload)

        if let total = request.duration {
            let remaining = total - offset
            if remaining > 0 {
                add("Remaining", remaining, Theme.textTertiary)
            }
        }

        return result
    }

    // MARK: - Helpers

    private func estimateHeaderSize(_ headers: [String: [String]]) -> Int64 {
        var size: Int64 = 0
        for (key, values) in headers {
            for value in values {
                size += Int64(key.utf8.count + value.utf8.count + 4) // "key: value\r\n"
            }
        }
        return size
    }
}

// MARK: - TimingPhase

private struct TimingPhase {
    let label: String
    let ms: Int64
    let startMs: Int64
    let endMs: Int64
    let color: Color
}

// MARK: - TimingPhaseRow

private struct TimingPhaseRow: View {
    let phase: TimingPhase
    let totalMs: Int64

    var body: some View {
        HStack(spacing: Theme.s8) {
            Text(phase.label)
                .font(.caption2)
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 100, alignment: .leading)

            GeometryReader { geo in
                let available = geo.size.width
                let startFrac = totalMs > 0 ? CGFloat(phase.startMs) / CGFloat(totalMs) : 0
                let widthFrac = totalMs > 0 ? CGFloat(phase.ms) / CGFloat(totalMs) : 1
                let barStart = available * startFrac
                let barWidth = max(4, available * widthFrac)

                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: Theme.radiusS)
                        .fill(Theme.surfaceRaised)
                    RoundedRectangle(cornerRadius: Theme.radiusS)
                        .fill(phase.color)
                        .frame(width: barWidth)
                        .offset(x: barStart)
                }
                .clipped()
            }
            .frame(height: 14)  // ui-token-check-ignore: chart bar or plot-area geometry

            Text(Fmt.formatDuration(phase.ms))
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 48, alignment: .trailing)
        }
        .padding(.vertical, Theme.s2)
    }
}

#if DEBUG
#Preview("Timing — Full") { TimingView(request: PreviewData.slow).padding() }
#Preview("Timing — Fast") { TimingView(request: PreviewData.get200).padding() }
#endif
#endif // canImport(UIKit)
