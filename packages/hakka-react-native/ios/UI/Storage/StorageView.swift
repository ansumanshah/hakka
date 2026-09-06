// @generated — do not edit. Synced from ios/Sources/UI/Storage/StorageView.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif

// MARK: - StorageView

/// Inspector panel for ``UserDefaults/standard``.
/// Displays all key-value pairs, supports deleting individual keys or clearing all.
/// Refreshes on a 1s timer when open.
struct StorageView: View {
    var onSettings: () -> Void = {}

    @State private var pairs: [DefaultsPair] = []
    @State private var searchText: String = ""
    @State private var confirmClearAll = false

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            searchBar
            if filteredPairs.isEmpty {
                emptyState
            } else {
                pairList
            }
        }
        .hakkaPageCanvas()
        .onAppear { refreshPairs() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                refreshPairs()
            }
        }
        .confirmationDialog(
            "Clear all UserDefaults?",
            isPresented: $confirmClearAll,
            titleVisibility: .visible
        ) {
            Button("Clear All", role: .destructive) {
                clearAll()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes every key from UserDefaults.standard. It cannot be undone.")
        }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: Theme.s8) {
            Image(systemName: "externaldrive")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textTertiary)

            Text("Storage")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.text)

            Spacer()

            Text("\(filteredPairs.count)")
                .font(.caption2.monospacedDigit().weight(.medium))
                .foregroundStyle(Theme.textSecondary)

            Button {
                confirmClearAll = true
            } label: {
                Image(systemName: "trash")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(pairs.isEmpty ? Theme.textTertiary : Theme.error)
            }
            .buttonStyle(.plain)
            .hakkaIconTarget()
            .disabled(pairs.isEmpty)
            .accessibilityLabel("Clear all UserDefaults")

            Button(action: onSettings) {
                Image(systemName: "gearshape")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            .buttonStyle(.plain)
            .hakkaIconTarget()
            .accessibilityLabel("Settings")
        }
        .hakkaInspectorToolbar()
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: Theme.s8) {
            Image(systemName: "magnifyingglass")
                .font(.caption)
                .foregroundStyle(Theme.textTertiary)
            TextField("Search keys and values", text: $searchText)
                .font(.caption)
                .foregroundStyle(Theme.text)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            if !searchText.isEmpty {
                Button { searchText = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(Theme.textTertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(Theme.s8)
        .hakkaGroupedCard(padding: Theme.s8, cornerRadius: Theme.radiusL)
        .padding(.horizontal, Theme.s16)
        .padding(.vertical, Theme.s8)
        .background(Theme.bg)
    }

    // MARK: - Pair List

    private var pairList: some View {
        ScrollView {
            LazyVStack(spacing: Theme.s8) {
                ForEach(filteredPairs) { pair in
                    DefaultsRow(pair: pair, searchText: searchText, onDelete: {
                        UserDefaults.standard.removeObject(forKey: pair.key)
                        Haptics.warning()
                        refreshPairs()
                    })
                }
            }
            .padding(.horizontal, HakkaMetrics.Layout.gutter)
            .padding(.bottom, Theme.s16)
        }
        .scrollIndicators(.hidden)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: Theme.s12) {
            Image(systemName: "externaldrive")
                .font(.largeTitle)
                .foregroundStyle(Theme.textTertiary)
            Text(searchText.isEmpty ? "UserDefaults is empty" : "No keys match")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Data

    private var filteredPairs: [DefaultsPair] {
        guard !searchText.isEmpty else { return pairs }
        let q = searchText.lowercased()
        return pairs.filter {
            $0.key.lowercased().contains(q) || $0.displayValue.lowercased().contains(q)
        }
    }

    private func refreshPairs() {
        let dict = UserDefaults.standard.dictionaryRepresentation()
        let all = dict.map { key, value in
            DefaultsPair(key: key, displayValue: describe(value))
        }
        .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }

        if all.map(\.key) != pairs.map(\.key) || all.map(\.displayValue) != pairs.map(\.displayValue) {
            pairs = all
        }
        // Publish on every refresh tick (not just on change) — snapshot-replace
        // semantics mean a stale desktop panel self-heals on the next 1s poll
        // regardless, and diffing here would just duplicate `pairs`' own diff
        // above for no benefit (`sendStorage` is cheap, fire-and-queued).
        let entries = Dictionary(uniqueKeysWithValues: all.map { ($0.key, $0.displayValue) })
        HakkaInterceptor.shared.publishStorageSnapshot(store: "defaults", entries: entries)
    }

    private func clearAll() {
        let dict = UserDefaults.standard.dictionaryRepresentation()
        for key in dict.keys {
            UserDefaults.standard.removeObject(forKey: key)
        }
        Haptics.warning()
        refreshPairs()
    }

    private func describe(_ value: Any) -> String {
        switch value {
        case let b as Bool:   return b ? "true" : "false"
        case let n as NSNumber: return n.stringValue
        case let s as String: return s
        case let a as [Any]:
            return "[\(a.count) items]"
        case let d as [String: Any]:
            return "{\(d.count) keys}"
        case let data as Data:
            return "<Data \(data.count) bytes>"
        default:
            return "\(value)"
        }
    }
}

// MARK: - DefaultsPair

private struct DefaultsPair: Identifiable {
    let key: String
    let displayValue: String
    var id: String { key }
}

// MARK: - DefaultsRow

private struct DefaultsRow: View {
    let pair: DefaultsPair
    var searchText: String = ""
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Theme.s8) {
            VStack(alignment: .leading, spacing: Theme.s2) {
                SearchHighlightedText(
                    text: pair.key,
                    searchText: searchText,
                    font: .caption2.monospaced().weight(.semibold),
                    color: Theme.info
                )
                SearchHighlightedText(
                    text: pair.displayValue,
                    searchText: searchText,
                    font: .caption2.monospaced(),
                    color: Theme.textSecondary
                )
                .textSelection(.enabled)
                .lineLimit(3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .hakkaGroupedCard(padding: Theme.s10, cornerRadius: Theme.radiusL)
        .contentShape(Rectangle())
        .onTapGesture {
            UIPasteboard.general.string = pair.displayValue
            Haptics.light()
        }
        .contextMenu {
            Button {
                UIPasteboard.general.string = pair.key
                Haptics.light()
            } label: {
                Label("Copy Key", systemImage: "doc.on.doc")
            }
            Button {
                UIPasteboard.general.string = pair.displayValue
                Haptics.light()
            } label: {
                Label("Copy Value", systemImage: "doc.on.doc.fill")
            }
            Divider()
            Button(role: .destructive, action: onDelete) {
                Label("Delete Key", systemImage: "trash")
            }
        }
    }
}

#if DEBUG
#Preview("Storage — With Data") {
    UserDefaults.standard.set("hello", forKey: "hakka.preview.string")
    UserDefaults.standard.set(42, forKey: "hakka.preview.number")
    UserDefaults.standard.set(true, forKey: "hakka.preview.bool")
    return StorageView()
}
#Preview("Storage — Empty") { StorageView() }
#endif
#endif // canImport(UIKit)
