#if canImport(UIKit)
import HakkaCommon
import HakkaNetwork
import SwiftUI
import UIKit

// MARK: - Tab Content
//
// Split across sibling files in this directory:
//   - DetailHelpers.swift          — this file: Request/Response/GraphQL/Frames/
//                                    Timing tab content, and the shared "Mock
//                                    This" / curl / URLSession export logic
//   - DetailOverviewContent.swift  — the Overview tab (its own file: the
//                                    largest single tab body)
//   - DetailCookieViews.swift      — ParsedCookieRow, CookieAttrChip, FlowRow

extension RequestDetailView {

    // MARK: - Request Tab

    @ViewBuilder
    var requestContent: some View {
        VStack(alignment: .leading, spacing: Theme.s12) {
            let hasBody = request.requestBody != nil && !request.requestBody!.isEmpty
            let hasQuery = URL(string: request.url)?.query != nil

            if hasQuery {
                queryParamsSection
            }

            if hasBody {
                bodySection(
                    title: "Request Body",
                    content: request.requestBody!,
                    contentType: request.requestContentType,
                    contentEncoding: request.requestContentEncoding
                )
            } else if !hasQuery {
                Text("(no request body)")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .hakkaPaneContent()
    }

    // MARK: - Response Tab

    @ViewBuilder
    var responseContent: some View {
        VStack(alignment: .leading, spacing: Theme.s12) {
            if let imageType = ImageDetection.imageContentType(from: request.responseHeaders) {
                imagePreview(contentType: imageType)
            }

            if let body = request.responseBody, !body.isEmpty {
                bodySection(
                    title: "Response Body",
                    content: body,
                    contentType: request.contentType,
                    contentEncoding: request.contentEncoding
                )
            } else {
                Text("(no response body)")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .hakkaPaneContent()
    }

    // MARK: - GraphQL Tab

    @ViewBuilder
    var graphqlContent: some View {
        GraphQLDetailView(request: request)
            .hakkaPaneContent()
    }

    // MARK: - Frames Tab

    @ViewBuilder
    var framesContent: some View {
        WsFramesView(request: request)
            .hakkaPaneContent()
    }

    // MARK: - Timing Tab

    @ViewBuilder
    var timingContent: some View {
        VStack(alignment: .leading, spacing: Theme.s16) {
            // Neighboring requests — context around this request
            let neighbors = neighboringRequests
            if neighbors.count > 1 {
                overviewSection("Around this request") {
                    ForEach(neighbors, id: \.id) { neighbor in
                        HStack(spacing: Theme.s6) {
                            MethodBadge(method: neighbor.method)

                            SearchHighlightedText(
                                text: URL(string: neighbor.url)?.path ?? neighbor.url,
                                searchText: searchText,
                                font: .caption,
                                color: neighbor.id == request.id ? Theme.text : Theme.textSecondary,
                                lineLimit: 1,
                                truncationMode: .middle
                            )

                            Spacer()

                            if let ms = neighbor.duration {
                                Text(Fmt.formatDuration(ms))
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(Theme.textSecondary)
                            }

                            if let code = neighbor.status {
                                Text("\(code)")
                                    .font(.caption2.monospacedDigit().weight(.semibold))
                                    .foregroundStyle(Theme.statusColor(for: code))
                            }
                        }
                        .padding(.vertical, Theme.s2)
                        .padding(.horizontal, Theme.s4)
                        .background(neighbor.id == request.id ? Theme.surface : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                    }
                }
            }

            // Phase timing waterfall
            if hasTimingData {
                overviewSection("Timing") {
                    TimingView(request: request)
                }
            } else if let ms = request.duration {
                overviewSection("Timing") {
                    KeyValueRow(key: "Total", value: Fmt.formatDuration(ms))
                    Text("No phase-level data available.")
                        .font(.caption2)
                        .foregroundStyle(Theme.textTertiary)
                }
            }
        }
        .hakkaPaneContent()
    }

    private var neighboringRequests: [NetworkRequest] {
        let all = HakkaInterceptor.shared.store.requests
        guard let idx = all.firstIndex(where: { $0.id == request.id }) else { return [request] }
        let start = max(0, idx - 4)
        let end = min(all.count, idx + 5)
        return Array(all[start..<end])
    }

    // MARK: - Overview Helpers
    //
    // `overviewSection` is used only by `timingContent` above (same file).
    // `overviewCard`/`overviewRow` are used by `overviewContent`
    // (DetailOverviewContent.swift) too, so they carry no access modifier.

    @ViewBuilder
    private func overviewSection<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: Theme.s6) {
            SectionHeader(title: title)
            content()
        }
    }

    @ViewBuilder
    func overviewCard<C: View>(_ title: String, @ViewBuilder content: @escaping () -> C) -> some View {
        OverviewCard(title: title, content: content)
    }

    func overviewRow(
        _ key: String,
        _ value: String,
        mono: Bool = false,
        selectable: Bool = false,
        valueColor: Color = Theme.text
    ) -> some View {
        KeyValueRow(
            key: key,
            value: value,
            mono: mono,
            selectable: selectable,
            keyColor: Theme.info.opacity(0.9),
            valueColor: valueColor,
            searchText: searchText
        )
    }

    // MARK: - Helpers

    var hasTimingData: Bool {
        request.dnsMs != nil || request.tlsMs != nil || request.connectMs != nil
            || request.ttfbMs != nil || request.downloadMs != nil
    }

    func copyCurl() {
        Haptics.light()
        UIPasteboard.general.string = CurlExporter.export(request)
        copiedCurl = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copiedCurl = false }
    }

    func copyURLSessionCode() {
        Haptics.light()
        UIPasteboard.general.string = URLSessionExporter.export(request)
        copiedURLSession = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copiedURLSession = false }
    }

    // MARK: - Mock This (QA loop-closer)

    /// True when this request has a captured response worth mocking — a
    /// status or a response body. Matches the web `canMock` gate.
    var canMockThis: Bool {
        request.status != nil || request.responseBody != nil
    }

    /// "Record, then mock": freeze the captured response into an enabled
    /// `MockEngine` rule (same path `hakka mcp`'s `generate_mocks` and the
    /// web Mock tab use). View/toggle/remove the rule from Rules → Mocks
    /// (`MocksView`).
    func mockThis() {
        guard let input = MockRuleBuilder.build(from: request) else { return }
        MockEngine.shared.addRule(input)
        Haptics.medium()
        mockedThis = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { mockedThis = false }
    }
}
#endif // canImport(UIKit)
