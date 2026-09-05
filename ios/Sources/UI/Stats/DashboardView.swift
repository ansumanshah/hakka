#if canImport(UIKit)
import SwiftUI
import HakkaCommon
import HakkaNetwork
import HakkaPerformance

// MARK: - DashboardView

/// Monitor dashboard: overview cards, domain breakdown, method breakdown,
/// slowest requests, duration stats, size stats.
///
/// Embedded-only — presented as the Inspector's Stats tab with a plain
/// toolbar matching the other built-in tabs (gear icon included). There is
/// no standalone/sheet presentation. `requests` live-polls from the
/// interceptor store rather than staying frozen at whatever snapshot was
/// passed in, matching every other tab's live-refresh behavior.
///
/// Split across sibling files in this directory — this file keeps the
/// struct's stored state and top-level layout; every section body and
/// computed metric lives in a `DashboardView*.swift` extension (mirroring
/// the `BubbleWindow*` split under `Overlay/`, since stored properties can't
/// live in an extension). Stored properties below carry no access modifier
/// (internal) so the extension files can reach them — same trade as
/// `BubbleWindow.swift` documents at its own type declaration.
struct DashboardView: View {
    var onSettings: () -> Void = {}
    @StateObject var performanceMonitor = DashboardPerformanceMonitor()
    @State var showDetails = true
    @State var selectedRequest: NetworkRequest?
    @State var requests: [NetworkRequest]
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(requests: [NetworkRequest], onSettings: @escaping () -> Void = {}) {
        self._requests = State(initialValue: requests)
        self.onSettings = onSettings
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            dashboardScrollContent
        }
        .onAppear { performanceMonitor.start() }
        .onDisappear { performanceMonitor.stop() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(0.5))
                let latest = HakkaInterceptor.shared.store.requests
                if latest != requests { requests = latest }
            }
        }
        .sheet(item: $selectedRequest) { request in
            RequestDetailView(request: request)
        }
    }

    /// Matches the other built-in tabs' toolbar shape (icon + title + gear).
    var toolbar: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Theme.s6) {
                    title
                    Button(action: onSettings) {
                        Label("Settings", systemImage: "gearshape")
                    }
                    .buttonStyle(.bordered)
                    .frame(minHeight: Theme.tapMin)
                }
            } else {
                HStack(spacing: Theme.s8) {
                    title
                    Spacer()
                    settingsButton
                }
            }
        }
        .hakkaInspectorToolbar()
    }

    private var title: some View {
        HStack(spacing: Theme.s8) {
            Image(systemName: "chart.bar.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textTertiary)
            Text("Stats")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.text)
        }
    }

    private var settingsButton: some View {
        Button(action: onSettings) {
            Image(systemName: "gearshape")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textSecondary)
        }
        .buttonStyle(.plain)
        .hakkaIconTarget()
        .accessibilityLabel("Settings")
    }

    var dashboardScrollContent: some View {
        ScrollView {
            VStack(spacing: Theme.s16) {
                summarySection
                chartSection
                detailedMetricsSection
            }
            .padding(HakkaMetrics.Layout.gutter)
        }
        .hakkaPageCanvas()
    }
}

#if DEBUG
#Preview("Monitor — Full") { DashboardView(requests: PreviewData.batch) }
#Preview("Monitor — Empty") { DashboardView(requests: []) }
#endif
#endif // canImport(UIKit)
