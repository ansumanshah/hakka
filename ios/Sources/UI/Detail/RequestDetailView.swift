#if canImport(UIKit)
import HakkaCommon
import HakkaNetwork
import SwiftUI
import UIKit

// MARK: - DetailTab

enum DetailTab: String, CaseIterable {
    case overview, request, response, graphql, frames, timing
}

// MARK: - RequestDetailView

/// Tab-based detail view for a single network request.
struct RequestDetailView: View {
    let request: NetworkRequest
    var onBack: (() -> Void)? = nil

    @State var selectedTab: DetailTab = .overview
    @State var showShareSheet = false
    @State var shareItems: ShareItems? = nil
    @State var copiedCurl = false
    @State var copiedURLSession = false
    @State var mockedThis = false
    @State var searchText = ""
    @State var showSearch = false

    var body: some View {
        VStack(spacing: 0) {
            Group {
                if #available(iOS 26.0, *) {
                    GlassEffectContainer(spacing: Theme.s8) {
                        chrome
                    }
                } else {
                    chrome
                }
            }
            ScrollView {
                switch selectedTab {
                case .overview: overviewContent
                case .request: requestContent
                case .response: responseContent
                case .graphql: graphqlContent
                case .frames: framesContent
                case .timing: timingContent
                }
            }
        }
        .background(Theme.bg)
        .sheet(isPresented: $showShareSheet) {
            ShareSheet(items: ReportHelper.buildShareItems(from: request).items)
        }
        .sheet(item: $shareItems) { item in
            ShareSheet(items: item.items)
        }
    }

    // MARK: - Compact Header

    private var chrome: some View {
        VStack(spacing: Theme.s8) {
            compactHeader
            tabBar
            if showSearch {
                searchBar
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .padding(.horizontal, Theme.s12)
        .padding(.top, Theme.s10)
        .padding(.bottom, Theme.s8)
        .background(Theme.bg)
    }

    private var compactHeader: some View {
        HStack(spacing: Theme.s8) {
            if let onBack {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: HakkaMetrics.ControlHeight.icon, height: HakkaMetrics.ControlHeight.icon)
                        .hakkaControlGlass(cornerRadius: 15)
                }
                .buttonStyle(.plain)
            }
            MethodBadge(method: request.method)
            headerUrl.lineLimit(1)
            Spacer()
            headerStatusDuration
            detailMenu
        }
        .padding(.horizontal, Theme.s4)
        .frame(height: HakkaMetrics.ControlHeight.nav)
    }

    @ViewBuilder
    private var headerUrl: some View {
        let parsed = URL(string: request.url)
        let path = parsed?.path ?? request.url
        let displayPath = path.isEmpty ? "/" : path
        HStack(spacing: 0) {
            SearchHighlightedText(
                text: displayPath,
                searchText: searchText,
                font: .footnote.monospaced().weight(.medium),
                color: Theme.text,
                lineLimit: 1,
                truncationMode: .middle
            )
            if let query = parsed?.query, !query.isEmpty {
                SearchHighlightedText(
                    text: "?\(query)",
                    searchText: searchText,
                    font: .footnote.monospaced(),
                    color: Theme.textTertiary,
                    lineLimit: 1
                )
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            UIPasteboard.general.string = request.url
            Haptics.light()
        }
        .contextMenu {
            Button {
                UIPasteboard.general.string = request.url
                Haptics.light()
            } label: {
                Label("Copy URL", systemImage: "link")
            }
        }
    }

    private var headerStatusDuration: some View {
        HStack(spacing: Theme.s6) {
            if let code = request.status {
                Text("\(code)")
                    .font(.footnote.monospacedDigit().weight(.bold))
                    .foregroundStyle(Theme.statusColor(for: code))
            } else if request.error != nil {
                Text("ERR")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(Theme.error)
            }
            if let ms = request.duration {
                Text(Fmt.formatDuration(ms))
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private var detailMenu: some View {
        Menu {
            Button {
                copyCurl()
            } label: {
                Label(copiedCurl ? "Copied cURL" : "Copy cURL", systemImage: copiedCurl ? "checkmark" : "terminal")
            }

            Button {
                copyURLSessionCode()
            } label: {
                Label(
                    copiedURLSession ? "Copied URLSession" : "Copy as URLSession",
                    systemImage: copiedURLSession ? "checkmark" : "doc.on.doc"
                )
            }

            Button {
                UIPasteboard.general.string = request.url
                Haptics.light()
            } label: {
                Label("Copy URL", systemImage: "link")
            }

            Button {
                UIPasteboard.general.string = ReportHelper.otelJson(from: [request])
                Haptics.light()
            } label: {
                Label("Copy OTel", systemImage: "doc.on.doc")
            }

            Button {
                Haptics.medium()
                showShareSheet = true
            } label: {
                Label("Share Report", systemImage: "square.and.arrow.up")
            }

            if canMockThis {
                Divider()
                Button {
                    mockThis()
                } label: {
                    Label(
                        mockedThis ? "Mocked" : "Mock this",
                        systemImage: mockedThis ? "checkmark" : "theatermasks"
                    )
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: HakkaMetrics.ControlHeight.icon, height: HakkaMetrics.ControlHeight.icon)
                .hakkaControlGlass(cornerRadius: 15)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Request actions"))
    }

    // MARK: - Tab Bar

    private func tabLabel(_ tab: DetailTab) -> String {
        switch tab {
        case .graphql: return "GraphQL"
        case .frames: return "Frames"
        default: return tab.rawValue.capitalized
        }
    }

    private var visibleTabs: [DetailTab] {
        let hasFrames = request.source == .nativeWebSocket || request.source == .jsWebSocket
        return DetailTab.allCases.filter { tab in
            switch tab {
            case .graphql: return request.graphqlOperationName != nil
            case .frames: return hasFrames
            default: return true
            }
        }
    }

    private var tabBar: some View {
        HStack(spacing: HakkaMetrics.Spacing.xxs) {
            ForEach(visibleTabs, id: \.self) { tab in
                let isActive = selectedTab == tab
                Button(action: {
                    withAnimation(.easeInOut(duration: 0.15)) { selectedTab = tab }
                }) {
                    VStack(spacing: HakkaMetrics.Spacing.xxs) {
                        Text(tabLabel(tab).uppercased())
                            .font(.system(size: HakkaMetrics.FontSize.sm, weight: isActive ? .bold : .medium, design: .monospaced))
                            .kerning(0.6)
                            .foregroundStyle(isActive ? Theme.accent : Theme.textSecondary)
                        // Flame underline for the active tab.
                        Capsule()
                            .fill(isActive ? Theme.accent : Color.clear)
                            .frame(height: 2)  // ui-token-check-ignore: rule/rail thickness
                    }
                    .padding(.horizontal, Theme.s10)
                    .padding(.top, Theme.s6)
                }
                .buttonStyle(.plain)
            }
            Spacer()

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showSearch.toggle()
                    if !showSearch { searchText = "" }
                }
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.caption)
                    .foregroundStyle(showSearch ? Theme.accent : Theme.textSecondary)
                    .frame(width: HakkaMetrics.ControlHeight.icon, height: HakkaMetrics.ControlHeight.icon)
                    .hakkaControlGlass(cornerRadius: 14)
            }
            .buttonStyle(.plain)
        }
        .padding(Theme.s4)
        .hakkaGlassSurface(tint: Theme.controlTint, cornerRadius: Theme.radiusXL)
    }

    private var searchBar: some View {
        HStack(spacing: Theme.s8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.textSecondary)
                .font(.caption)
            TextField("Search headers, body, URL...", text: $searchText)
                .textFieldStyle(.plain)
                .font(.caption)
                .foregroundStyle(Theme.text)
            if !searchText.isEmpty {
                Button { searchText = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.textSecondary)
                        .font(.caption)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, Theme.s12)
        .frame(height: HakkaMetrics.ControlHeight.field)
        .hakkaGlassSurface(tint: Theme.controlTint, cornerRadius: Theme.radiusXL, interactive: true)
    }
}

#if DEBUG
#Preview("Detail — 200") { RequestDetailView(request: PreviewData.get200) }
#Preview("Detail — Error") { RequestDetailView(request: PreviewData.dnsError) }
#Preview("Detail — Slow") { RequestDetailView(request: PreviewData.slow, selectedTab: .timing) }
#Preview("Detail — Redirect") { RequestDetailView(request: PreviewData.redirect) }
#endif
#endif // canImport(UIKit)
