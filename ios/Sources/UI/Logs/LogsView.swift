#if canImport(UIKit)
import SwiftUI
import HakkaCommon
import HakkaNetwork

// MARK: - LogsView

/// Inspector panel that renders structured ``LogEntry`` items captured via
/// ``HakkaInterceptor/log(_:_:category:metadata:)`` (backed by
/// ``HakkaInterceptor/logStore``). Distinct from ``ConsoleView``, which shows
/// unstructured ``ConsoleEntry`` lines from ``HakkaConsole``.
///
/// Live-updates via ``HakkaLogStore/subscribe(_:)`` rather than polling.
struct LogsView: View {
    /// Hidden when embedded under the Logs tab's Console/Structured segmented
    /// switch, which already shows the section name — avoids a duplicate
    /// title there. The count + clear action stay either way.
    var showToolbar: Bool = true

    @State private var entries: [LogEntry] = []
    @State private var levelFilter: LogLevel? = nil
    @State private var searchText: String = ""
    @State private var expandedIDs: Set<String> = []
    @State private var subscription: HakkaLogSubscription?

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            filterBar
            if filteredEntries.isEmpty {
                emptyState
            } else {
                entryList
            }
        }
        .hakkaPageCanvas()
        .onAppear {
            refreshEntries()
            subscription = HakkaInterceptor.shared.logStore.subscribe { _ in
                Task { @MainActor in refreshEntries() }
            }
        }
        .onDisappear {
            subscription?.unsubscribe()
            subscription = nil
        }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: Theme.s8) {
            if showToolbar {
                Image(systemName: "list.bullet.rectangle")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.textTertiary)

                Text("Structured")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.text)
            }

            Spacer()

            Text("\(filteredEntries.count)")
                .font(.caption2.monospacedDigit().weight(.medium))
                .foregroundStyle(Theme.textSecondary)

            Button {
                HakkaInterceptor.shared.logStore.clear()
                refreshEntries()
                Haptics.warning()
            } label: {
                Image(systemName: "trash")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(entries.isEmpty ? Theme.textTertiary : Theme.textSecondary)
            }
            .buttonStyle(.plain)
            .disabled(entries.isEmpty)
            .accessibilityLabel("Clear logs")
        }
        .hakkaInspectorToolbar()
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            TextField("Search logs", text: $searchText)
                .font(.body)
                .foregroundStyle(Theme.text)
                .padding(.horizontal, Theme.s12)
                .frame(minHeight: Theme.tapMin)
                .hakkaControlGlass(cornerRadius: Theme.radiusL)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.s6) {
                levelChip(nil, label: "All")
                ForEach(LogLevel.allCases, id: \.rawValue) { level in
                    levelChip(level, label: level.label)
                }
                }
            }
        }
        .padding(.horizontal, HakkaMetrics.Layout.gutter)
        .padding(.vertical, Theme.s8)
        .background(Theme.surfaceRaised)
    }

    private func levelChip(_ level: LogLevel?, label: String) -> some View {
        HakkaChip(label: label, isActive: levelFilter == level, tone: Theme.accent, mono: false) {
            levelFilter = level
        }
    }

    private func chipColor(_ level: LogLevel?) -> Color {
        switch level {
        case .debug: return Theme.textTertiary
        case .info:  return Theme.info
        case .warn:  return Theme.warning
        case .error: return Theme.error
        case nil:    return Theme.info
        }
    }

    // MARK: - Entry List

    private var entryList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: Theme.s8) {
                    ForEach(filteredEntries) { entry in
                        LogEntryRow(
                            entry: entry,
                            searchText: searchText,
                            isExpanded: expandedIDs.contains(entry.id),
                            onToggleExpanded: { toggleExpanded(entry.id) }
                        )
                        .id(entry.id)
                    }
                }
                .padding(.horizontal, HakkaMetrics.Layout.gutter)
                .padding(.bottom, Theme.s16)
            }
            .scrollIndicators(.hidden)
            .onChange(of: filteredEntries.count) { _ in
                if let last = filteredEntries.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    private func toggleExpanded(_ id: String) {
        withAnimation(.spring(response: 0.25, dampingFraction: 0.9)) {
            if expandedIDs.contains(id) {
                expandedIDs.remove(id)
            } else {
                expandedIDs.insert(id)
            }
        }
        Haptics.light()
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: Theme.s12) {
            Image(systemName: "list.bullet.rectangle")
                .font(.largeTitle)
                .foregroundStyle(Theme.textTertiary)
            Text("No logs")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.textSecondary)
            Text("Call HakkaInterceptor.shared.log(.info, \"message\") to capture entries here.")
                .font(.caption)
                .foregroundStyle(Theme.textTertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, Theme.s20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Data

    private var filteredEntries: [LogEntry] {
        entries.filter { entry in
            if let level = levelFilter, entry.level != level { return false }
            if !searchText.isEmpty {
                let haystack = [entry.message, entry.category ?? ""].joined(separator: " ")
                if !haystack.localizedCaseInsensitiveContains(searchText) { return false }
            }
            return true
        }
    }

    private func refreshEntries() {
        let latest = HakkaInterceptor.shared.logStore.getEntries()
        if latest.map(\.id) != entries.map(\.id) {
            entries = latest
        }
    }
}

// MARK: - LogEntryRow

private struct LogEntryRow: View {
    let entry: LogEntry
    var searchText: String = ""
    var isExpanded: Bool = false
    var onToggleExpanded: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: Theme.s8) {
                levelBadge

                VStack(alignment: .leading, spacing: Theme.s2) {
                    HStack(spacing: Theme.s6) {
                        if let category = entry.category, !category.isEmpty {
                            Text(category)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        Text(timestampText)
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(Theme.textTertiary)
                    }

                    SearchHighlightedText(
                        text: entry.message,
                        searchText: searchText,
                        font: .caption2,
                        color: Theme.text
                    )
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if hasMetadata {
                    Button(action: onToggleExpanded) {
                        Image(systemName: "chevron.right")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.textTertiary)
                            .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, Theme.s6)
            .contentShape(Rectangle())
            .onTapGesture {
                if hasMetadata { onToggleExpanded() }
            }

            if isExpanded, let metadata = entry.metadata, !metadata.isEmpty {
                metadataView(metadata)
                    .padding(.bottom, Theme.s8)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .contextMenu {
            Button {
                UIPasteboard.general.string = entry.message
                Haptics.light()
            } label: {
                Label("Copy Message", systemImage: "doc.on.doc")
            }
            Button {
                UIPasteboard.general.string = "[\(entry.level.label)] \(entry.category.map { "[\($0)] " } ?? "")\(entry.message)"
                Haptics.light()
            } label: {
                Label("Copy with Level", systemImage: "doc.on.doc.fill")
            }
        }
        .hakkaGroupedCard(padding: Theme.s10, cornerRadius: Theme.radiusL)
    }

    private var hasMetadata: Bool {
        !(entry.metadata?.isEmpty ?? true)
    }

    private func metadataView(_ metadata: [String: String]) -> some View {
        VStack(alignment: .leading, spacing: Theme.s4) {
            ForEach(metadata.keys.sorted(), id: \.self) { key in
                KeyValueRow(
                    key: key,
                    value: metadata[key] ?? "",
                    mono: true,
                    selectable: true,
                    searchText: searchText
                )
            }
        }
        .padding(Theme.s8)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
        .padding(.leading, 48)  // ui-token-check-ignore: empty-state optical inset
    }

    private var levelBadge: some View {
        Text(entry.level.label)
            .font(.system(size: HakkaMetrics.FontSize.xxs, weight: .heavy, design: .rounded))
            .foregroundStyle(.white)
            .padding(.horizontal, Theme.s4)
            .padding(.vertical, HakkaMetrics.Spacing.xxs)
            .background(levelColor)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
            .frame(width: HakkaMetrics.ControlHeight.nav)
    }

    private var levelColor: Color {
        switch entry.level {
        case .debug: return Theme.textTertiary
        case .info:  return Theme.info
        case .warn:  return Theme.warning
        case .error: return Theme.error
        }
    }

    private var timestampText: String {
        let ms = entry.timestamp
        let date = Date(timeIntervalSince1970: Double(ms) / 1000.0)
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter.string(from: date)
    }
}

#if DEBUG
private func seedPreviewLogEntries() {
    let interceptor = HakkaInterceptor.shared
    interceptor.logStore.clear()
    interceptor.logDebug("App launched", category: "lifecycle")
    interceptor.logInfo("User authenticated", category: "auth", metadata: ["userId": "u_123", "method": "oauth"])
    interceptor.logWarn("Network timeout after 30s", category: "network")
    interceptor.logError("Failed to load image", category: "media", metadata: ["url": "https://example.com/a.png", "code": "-1009"])
}

#Preview("Logs — With Entries") {
    LogsView()
        .onAppear { seedPreviewLogEntries() }
}

#Preview("Logs — Empty") { LogsView() }
#endif
#endif // canImport(UIKit)
