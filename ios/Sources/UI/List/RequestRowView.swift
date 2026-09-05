#if canImport(UIKit)
import SwiftUI
import HakkaCommon
import HakkaNetwork

// MARK: - RequestRowView

/// 2-line request row: method badge + path (+ status/host below), with a
/// stacked duration/size column right-aligned across both lines. Baselined
/// at the `Theme.rowH` (64pt) token as a *minimum* — rows grow past it under
/// larger Dynamic Type sizes instead of clipping content, trading
/// predictable rows-per-screen for accessible text.
struct RequestRowView: View {
    let request: NetworkRequest
    var isPinned: Bool = false
    var isSelected: Bool = false
    var searchText: String = ""

    var body: some View {
        HStack(spacing: 0) {
            // Severity stripe — chili for 5xx/error, turmeric for 4xx,
            // flame for the selected row. 2pt, flush to the leading edge.
            Rectangle()
                .fill(stripeColor ?? Color.clear)
                .frame(width: 2)

            HStack(alignment: .top, spacing: Theme.s6) {
                VStack(alignment: .leading, spacing: Theme.s6) {
                    HStack(spacing: Theme.s6) {
                        MethodLabel(method: request.method)

                        SearchHighlightedText(
                            text: pathComponent,
                            searchText: searchText,
                            font: .subheadline.weight(.medium),
                            color: Theme.text,
                            lineLimit: 1,
                            truncationMode: .middle
                        )
                            .truncationMode(.middle)
                            .lineLimit(1)

                        if isPinned {
                            Image(systemName: "pin.fill")
                                .font(.system(size: Theme.iconS))
                                .foregroundStyle(Theme.warning)
                        }
                    }

                    // Line 2: status + host. The absolute timestamp is
                    // dropped at mobile width — during a live capture session
                    // everything on screen is "now," so the field
                    // earns its column back for host, which used to get
                    // truncated first. Timestamp still exists in Detail →
                    // Overview → Started, just not fighting for row width.
                    HStack(spacing: Theme.s6) {
                        statusIndicator

                        SearchHighlightedText(
                            text: hostText,
                            searchText: searchText,
                            font: .footnote,
                            color: Theme.textTertiary,
                            lineLimit: 1,
                            truncationMode: .tail
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                // Duration over size in one right-aligned column — mirrors the
                // path-over-host stack beside it, both mono/tabular.
                VStack(alignment: .trailing, spacing: HakkaMetrics.Spacing.xxs) {
                    Text(durationText)
                        .font(.footnote.monospacedDigit().weight(.medium))
                        .foregroundStyle(durationColor)
                    if request.responseBodySize > 0 {
                        Text(formatBytes(request.responseBodySize))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(Theme.textTertiary.opacity(0.75))
                    }
                }
                .frame(minWidth: 52, alignment: .trailing)
            }
            .padding(.leading, Theme.rowPadH)
            .padding(.trailing, Theme.rowPadH)
            .padding(.vertical, Theme.rowPadV)
        }
        .frame(minHeight: Theme.rowH)
        .background(rowBackground, in: RoundedRectangle(cornerRadius: Theme.radiusL, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.radiusL, style: .continuous)
                .stroke(isSelected ? Theme.accent.opacity(0.45) : Theme.border.opacity(0.45), lineWidth: 0.5)
        }
        .contentShape(Rectangle())
    }

    // MARK: - Status Indicator

    @ViewBuilder
    private var statusIndicator: some View {
        if let code = request.status {
            Text("\(code)")
                .font(.footnote.monospacedDigit().weight(.semibold))
                .foregroundStyle(Theme.statusColor(for: code))
        } else if request.error != nil {
            Text("ERR")
                .font(.footnote.weight(.bold))
                .foregroundStyle(Theme.error)
        } else {
            ProgressView()
                .controlSize(.mini)
        }
    }

    // MARK: - Computed

    private var pathComponent: String {
        let parsed = URL(string: request.url)
        let path = parsed?.path ?? request.url
        let base = path.isEmpty ? "/" : path
        let visibleUrlPart: String
        if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           let query = parsed?.query, !query.isEmpty {
            visibleUrlPart = "\(base)?\(query)"
        } else {
            visibleUrlPart = base
        }
        if let opName = request.graphqlOperationName {
            return "\(visibleUrlPart) \u{25B8} \(opName)"
        }
        return visibleUrlPart
    }

    private var hostText: String { URL(string: request.url)?.host ?? "" }

    /// Severity stripe color — chili for a non-nil `error` (regardless of
    /// status, see `rowBackground`), chili for 5xx, turmeric for 4xx, flame
    /// for the selected row. `nil` (transparent) otherwise.
    private var stripeColor: Color? {
        if isSelected { return Theme.accent }
        if request.error != nil { return Theme.error }
        if let code = request.status {
            if code >= 500 { return Theme.error }
            if code >= 400 { return Theme.warning }
        }
        return nil
    }

    /// The error signal always wins for visual severity — status and error
    /// can legitimately coexist (e.g. a 200 whose headers arrived fine but
    /// the connection dropped mid-body), and hiding the tint whenever a
    /// status is present would hide a real transport failure. A non-nil
    /// `error` tints the row regardless of status; status >= 400 tints when
    /// there's no error. Matches Android's unconditional Error card and web
    /// parity. Text dedup (the status pill shows the code only, never an
    /// error sentence) lives in `statusIndicator`, not here.
    private var rowBackground: Color {
        if isSelected { return Theme.accent.opacity(0.09) }
        if request.error != nil { return Theme.error.opacity(0.08) }
        if let code = request.status, code >= 400 { return Theme.error.opacity(0.08) }
        return Theme.surfaceRaised
    }

    private var durationText: String {
        guard let ms = request.duration else { return "···" }
        if ms >= 1000 { return String(format: "%.1fs", Double(ms) / 1000.0) }
        return "\(ms)ms"
    }

    private var durationColor: Color {
        guard let ms = request.duration else { return Theme.textSecondary }
        if ms >= 3000 { return Theme.error }
        if ms >= 1000 { return Theme.warning }
        return Theme.textSecondary
    }

    private func formatBytes(_ bytes: Int64) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", Double(bytes) / 1024.0) }
        return String(format: "%.1f MB", Double(bytes) / (1024.0 * 1024.0))
    }
}

// MARK: - Previews

#if DEBUG
#Preview("200 OK") { RequestRowView(request: PreviewData.get200) }
#Preview("404") { RequestRowView(request: PreviewData.get404) }
#Preview("500") { RequestRowView(request: PreviewData.get500) }
#Preview("Error") { RequestRowView(request: PreviewData.dnsError) }
#Preview("Slow") { RequestRowView(request: PreviewData.slow) }
#Preview("Pending") { RequestRowView(request: PreviewData.pending) }
#Preview("Pinned") { RequestRowView(request: PreviewData.post201, isPinned: true) }
#Preview("Selected") { RequestRowView(request: PreviewData.get200, isSelected: true) }
#endif
#endif // canImport(UIKit)
