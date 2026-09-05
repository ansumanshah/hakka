// @generated — do not edit. Synced from ios/Sources/UI/Console/ConsoleView.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
#if canImport(HakkaCommon)
import HakkaCommon
#endif

// MARK: - ConsoleView

/// Inspector panel that renders captured ``ConsoleEntry`` items from
/// ``HakkaConsole/shared``. Refreshes on a 0.5s timer so new entries appear
/// automatically while the panel is open.
struct ConsoleView: View {
    /// Hidden when embedded under the Logs tab's Console/Structured segmented
    /// switch, which already shows the section name — avoids a duplicate
    /// title there. The count + clear action stay either way.
    var showToolbar: Bool = true

    @State private var entries: [ConsoleEntry] = []
    @State private var levelFilter: ConsoleLevel? = nil
    @State private var searchText: String = ""
    @Environment(\.dismiss) private var dismiss

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
        .background(Theme.bg)
        .onAppear { refreshEntries() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(0.5))
                refreshEntries()
            }
        }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: Theme.s8) {
            if showToolbar {
                Image(systemName: "terminal")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.textTertiary)

                Text("Console")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.text)
            }

            Spacer()

            Text("\(filteredEntries.count)")
                .font(.caption2.monospacedDigit().weight(.medium))
                .foregroundStyle(Theme.textSecondary)

            Button {
                HakkaConsole.shared.clear()
                refreshEntries()
                Haptics.warning()
            } label: {
                Image(systemName: "trash")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(entries.isEmpty ? Theme.textTertiary : Theme.textSecondary)
            }
            .buttonStyle(.plain)
            .disabled(entries.isEmpty)
            .accessibilityLabel("Clear console")
        }
        .padding(.horizontal, Theme.s16)
        .padding(.top, Theme.s10)
        .padding(.bottom, Theme.s6)
        .background(Theme.surface)
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.s6) {
                TextField("Search", text: $searchText)
                    .font(.caption)
                    .foregroundStyle(Theme.text)
                    .padding(.horizontal, Theme.s8)
                    .padding(.vertical, Theme.s4)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                    .frame(minWidth: 120)

                levelChip(nil, label: "All")
                ForEach(ConsoleLevel.allCases, id: \.rawValue) { level in
                    levelChip(level, label: level.label)
                }
            }
            .padding(.horizontal, Theme.s16)
            .padding(.vertical, Theme.s8)
        }
        .background(Theme.bg)
    }

    private func levelChip(_ level: ConsoleLevel?, label: String) -> some View {
        HakkaChip(label: label, isActive: levelFilter == level, tone: chipColor(level), mono: false) {
            levelFilter = level
        }
    }

    private func chipColor(_ level: ConsoleLevel?) -> Color {
        switch level {
        case .debug:  return Theme.textTertiary
        case .info:   return Theme.info
        case .warn:   return Theme.warning
        case .error:  return Theme.error
        case nil:     return Theme.info
        }
    }

    // MARK: - Entry List

    private var entryList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(filteredEntries) { entry in
                        ConsoleEntryRow(entry: entry, searchText: searchText)
                            .id(entry.id)
                    }
                }
                .padding(.horizontal, Theme.s16)
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

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: Theme.s12) {
            Image(systemName: "terminal")
                .font(.largeTitle)
                .foregroundStyle(Theme.textTertiary)
            Text("No console logs")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.textSecondary)
            Text("Call HakkaConsole.shared.log(.info, \"message\") to capture logs here.")
                .font(.caption)
                .foregroundStyle(Theme.textTertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, Theme.s20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Data

    private var filteredEntries: [ConsoleEntry] {
        entries.filter { entry in
            if let level = levelFilter, entry.level != level { return false }
            if !searchText.isEmpty,
               !entry.message.localizedCaseInsensitiveContains(searchText) { return false }
            return true
        }
    }

    private func refreshEntries() {
        let latest = HakkaConsole.shared.entries
        if latest.map(\.id) != entries.map(\.id) {
            entries = latest
        }
    }
}

// MARK: - ConsoleEntryRow

private struct ConsoleEntryRow: View {
    let entry: ConsoleEntry
    var searchText: String = ""

    var body: some View {
        HStack(alignment: .top, spacing: Theme.s8) {
            levelBadge
            VStack(alignment: .leading, spacing: Theme.s2) {
                SearchHighlightedText(
                    text: entry.message,
                    searchText: searchText,
                    font: .caption2.monospaced(),
                    color: Theme.text
                )
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)

                Text(timestampText)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .padding(.vertical, Theme.s6)
        .contentShape(Rectangle())
        .contextMenu {
            Button {
                UIPasteboard.general.string = entry.message
                Haptics.light()
            } label: {
                Label("Copy Message", systemImage: "doc.on.doc")
            }
            Button {
                UIPasteboard.general.string = "[\(entry.level.label)] \(entry.message)"
                Haptics.light()
            } label: {
                Label("Copy with Level", systemImage: "doc.on.doc.fill")
            }
        }
        Divider().overlay(Theme.border.opacity(0.5))
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
private func seedPreviewConsoleEntries() {
    let console = HakkaConsole.shared
    console.clear()
    console.log(.debug, "App launched")
    console.log(.info, "User authenticated: user@example.com")
    console.log(.warn, "Network timeout after 30s")
    console.log(.error, "Failed to load image: NSURLErrorDomain -1009")
    console.log(.debug, "Cache hit for key: avatar_123")
    console.log(.info, "Push notification received: { type: 'order', id: '456' }")
}

#Preview("Console — With Entries") {
    ConsoleView()
        .onAppear { seedPreviewConsoleEntries() }
}

#Preview("Console — Empty") { ConsoleView() }
#endif
#endif // canImport(UIKit)
