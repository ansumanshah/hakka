import HakkaCommon
import HakkaCore
import SwiftUI

/// Generic tabbed detail for any `NetworkRequest` — used for both a run's
/// response (`RunResult.record`) and a selected captured traffic row, since
/// both are the same record type. Tab grammar: Overview / Request /
/// Response / Timing, with the SSE tab appended for event-stream responses
/// by `DetailTab`.
struct NetworkRequestDetailView: View {
    let record: NetworkRequest
    /// nil for a manually-sent request (no bridge peer) or an imported
    /// session's record — see `DetailOverviewSection`.
    let deviceLabel: String?

    @State private var activeTab: DetailTab = .overview

    /// Decoded once per view construction (per record selection), not per
    /// body evaluation — gzip bodies must not re-decompress on every render.
    private let requestBody: RecordBody?
    private let responseBody: RecordBody?

    /// LLM usage parsed from the raw response body — raw, because the
    /// shared body-decoder pipeline rewrites event-stream bodies into a JSON
    /// event array, which is not a shape usage parses from.
    private let llmUsage: LlmUsage?

    init(record: NetworkRequest, deviceLabel: String? = nil) {
        self.record = record
        self.deviceLabel = deviceLabel
        self.requestBody = RecordBodyExtractor.requestBody(from: record)
        self.responseBody = RecordBodyExtractor.responseBody(from: record)
        self.llmUsage = parseLlmUsage(record.responseBody, provider: detectLlmProvider(url: record.url)?.id)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            DetailTabStrip(activeTab: $activeTab, tabs: DetailTab.visible(for: record))
            tabContent
                .padding(16)
        }
    }

    @ViewBuilder
    private var tabContent: some View {
        switch activeTab {
        case .overview:
            VStack(alignment: .leading, spacing: 16) {
                DetailOverviewSection(record: record, deviceLabel: deviceLabel)
                if let llmUsage {
                    LlmUsageSectionView(usage: llmUsage)
                }
            }
        case .request:
            DetailBodyTabSide(
                headersSection: DetailHeadersSection("Request Headers", headers: record.requestHeaders),
                recordBody: requestBody,
                url: record.url,
                noBodyLabel: "No request body",
                responseHeaders: record.responseHeaders
            )
        case .response:
            DetailBodyTabSide(
                headersSection: DetailHeadersSection("Response Headers", headers: record.responseHeaders),
                recordBody: responseBody,
                url: record.url,
                noBodyLabel: "No response body",
                responseHeaders: record.responseHeaders
            )
        case .timing:
            DetailTimingSection(record: record)
        case .sse:
            DetailSseTabView(record: record)
        }
    }
}

/// One body-bearing tab side: its headers table, then the viewer (or the
/// no-body empty state) the body's content type selects.
private struct DetailBodyTabSide: View {
    let headersSection: DetailHeadersSection
    let recordBody: RecordBody?
    let url: String
    let noBodyLabel: String
    let responseHeaders: [String: [String]]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            headersSection
            if let recordBody {
                BodyViewerView(body: recordBody, url: url, responseHeaders: responseHeaders)
            } else {
                Text(noBodyLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(Color.secondary.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
        }
    }
}
