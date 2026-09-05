// @generated — do not edit. Synced from ios/Sources/UI/List/RequestListView.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
import UIKit
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif

// MARK: - RequestListView

struct RequestListView: View {
    let onDismiss: () -> Void
    var onSettings: () -> Void = {}

    @State private var requests: [NetworkRequest] = []
    @State private var filterText = ""
    @State private var selectedDomains: Set<String> = []
    @State private var selectedMethods: Set<String> = []
    @State private var selectedStatusGroup: String?
    @State private var shareItems: ShareItems?
    @State private var selectionMode = false
    @State private var selectedIds: Set<String> = []
    @State private var pinnedIds: Set<String> = []
    @State private var selectedRequest: NetworkRequest?
    @State private var isPaused: Bool = HakkaInterceptor.shared.isPaused
    @State private var sortField: SortField = .time
    @State private var sortAscending: Bool = false
    @State private var groupBy: GroupBy = .none
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            if let req = selectedRequest {
                RequestDetailView(request: req, onBack: { selectedRequest = nil })
            } else {
                if selectionMode {
                    SelectionBar(
                        selectedCount: selectedIds.count,
                        onShare: shareSelected,
                        onDone: exitSelectionMode
                    )
                } else {
                    ListHeader(
                        requests: requests,
                        isPaused: isPaused,
                        onSelect: enterSelectionMode,
                        onShare: shareReport,
                        onClear: clearRequests,
                        onClose: { dismiss(); onDismiss() },
                        onTogglePause: togglePause,
                        onSettings: onSettings
                    )
                }
                // Sort/Group folds into FilterBar's "Filters +n" disclosure,
                // not a separate always-visible row.
                FilterBar(
                    filterText: $filterText,
                    requests: requests,
                    selectedDomains: $selectedDomains,
                    selectedMethods: $selectedMethods,
                    selectedStatusGroup: $selectedStatusGroup,
                    sortField: $sortField,
                    sortAscending: $sortAscending,
                    groupBy: $groupBy
                )

                if isPaused {
                    pausedBanner
                }

                if sortedFilteredRequests.isEmpty {
                    EmptyState()
                } else {
                    requestList
                }
            }
        }
        .hakkaPageCanvas()
        .onAppear {
            refreshRequests()
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(0.5))
                refreshRequests()
            }
        }
        .onChange(of: filterText) { _ in pushRecentFilter() }
        .onChange(of: selectedMethods) { _ in pushRecentFilter() }
        .onChange(of: selectedStatusGroup) { _ in pushRecentFilter() }
        .onChange(of: sortField) { _ in pushRecentFilter() }
        .onChange(of: sortAscending) { _ in pushRecentFilter() }
        .onChange(of: groupBy) { _ in pushRecentFilter() }
        .sheet(item: $shareItems) { item in
            ShareSheet(items: item.items)
        }
    }


    // MARK: - Paused Banner

    private var pausedBanner: some View {
        HStack(spacing: Theme.s6) {
            Image(systemName: "pause.circle.fill")
                .font(.caption.weight(.semibold))
            Text("Capture paused")
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(Theme.bg)
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.s6)
        .background(Theme.warning)
    }

    // MARK: - Request List

    private var requestList: some View {
        ScrollView {
            LazyVStack(spacing: Theme.s6) {
                let groups = sortedFilteredRequests.grouped(by: groupBy)
                let showHeaders = groupBy != .none && groups.count > 1

                ForEach(groups, id: \.label) { group in
                    if showHeaders {
                        GroupSectionHeader(label: group.label, count: group.requests.count)
                    }
                    ForEach(group.requests, id: \.id) { request in
                        if selectionMode {
                            selectableRow(for: request)
                        } else {
                            Button { selectedRequest = request } label: {
                                RequestRowView(
                                    request: request,
                                    isPinned: pinnedIds.contains(request.id),
                                    searchText: filterText
                                )
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                RequestContextMenu(
                                    request: request,
                                    isPinned: pinnedIds.contains(request.id),
                                    onPin: { togglePin(request.id) },
                                    onShare: { shareItems = $0 }
                                )
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, HakkaMetrics.Layout.gutter)
            .padding(.bottom, Theme.s16)
        }
        .scrollIndicators(.hidden)
    }

    private func selectableRow(for request: NetworkRequest) -> some View {
        let isSelected = selectedIds.contains(request.id)
        return Button {
            toggleSelection(request.id)
        } label: {
            HStack(spacing: Theme.s8) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? Theme.accent : Theme.textSecondary)
                    .font(.body)
                RequestRowView(request: request, isSelected: isSelected, searchText: filterText)
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Data

    /// Compiled DSL predicate, rebuilt whenever filterText changes.
    /// Regex/glob patterns are compiled once per query, not per request.
    private var dslPredicate: (NetworkRequest) -> Bool {
        let tokens = parseSearchTokens(filterText)
        let query = SearchQuery(tokens: tokens)
        return compileSearchQuery(query)
    }

    /// Requests after text/domain/method/status filters are applied (not yet sorted/grouped).
    private var filteredRequests: [NetworkRequest] {
        let matchesDsl: (NetworkRequest) -> Bool = filterText.isEmpty
            ? { _ in true }
            : dslPredicate

        return requests.filter { req in
            if !matchesDsl(req) { return false }

            if !selectedDomains.isEmpty,
               let host = URL(string: req.url)?.host,
               !selectedDomains.contains(host) {
                return false
            }
            if !selectedMethods.isEmpty,
               !selectedMethods.contains(req.method.rawValue) {
                return false
            }
            if let group = selectedStatusGroup {
                let code = req.status ?? 0
                switch group {
                case "1xx": if code < 100 || code >= 200 { return false }
                case "2xx": if code < 200 || code >= 300 { return false }
                case "3xx": if code < 300 || code >= 400 { return false }
                case "4xx": if code < 400 || code >= 500 { return false }
                case "5xx": if code < 500 || code >= 600 { return false }
                case "Err": if req.error == nil || req.status != nil { return false }
                default: break
                }
            }
            return true
        }
    }

    /// Filtered requests with sort applied. Pinned requests always lead when sort is by time.
    private var sortedFilteredRequests: [NetworkRequest] {
        let sorted = filteredRequests.sorted(by: sortField, ascending: sortAscending)
        if sortField == .time {
            let pinned = sorted.filter { pinnedIds.contains($0.id) }
            let unpinned = sorted.filter { !pinnedIds.contains($0.id) }
            return pinned + unpinned
        }
        return sorted
    }

    private func pushRecentFilter() {
        let preset = FilterPreset(
            searchQuery: filterText,
            methodFilters: selectedMethods,
            statusGroup: selectedStatusGroup,
            sortField: sortField,
            sortAscending: sortAscending,
            groupBy: groupBy
        )
        FilterPresetStore.shared.pushRecent(preset)
    }

    private func refreshRequests() {
        let latest = HakkaInterceptor.shared.store.requests
        if latest != requests {
            requests = latest
        }
        let paused = HakkaInterceptor.shared.isPaused
        if paused != isPaused {
            isPaused = paused
        }
    }

    private func togglePause() {
        Haptics.light()
        if HakkaInterceptor.shared.isPaused {
            HakkaInterceptor.shared.resume()
        } else {
            HakkaInterceptor.shared.pause()
        }
        isPaused = HakkaInterceptor.shared.isPaused
    }

    private func clearRequests() {
        Haptics.warning()
        HakkaInterceptor.shared.clear()
        requests = []
        pinnedIds = []
    }

    // MARK: - Pin

    private func togglePin(_ id: String) {
        Haptics.light()
        if pinnedIds.contains(id) {
            pinnedIds.remove(id)
        } else {
            pinnedIds.insert(id)
        }
    }

    // MARK: - Selection

    private func enterSelectionMode() {
        selectionMode = true
        selectedIds = []
    }

    private func exitSelectionMode() {
        selectionMode = false
        selectedIds = []
    }

    private func toggleSelection(_ id: String) {
        if selectedIds.contains(id) {
            selectedIds.remove(id)
        } else {
            selectedIds.insert(id)
        }
    }

    // MARK: - Report / Share

    private func shareReport() {
        let batch = Array(sortedFilteredRequests.prefix(100))
        shareItems = ReportHelper.buildShareItems(from: batch)
    }

    private func shareSelected() {
        let selected = sortedFilteredRequests.filter { selectedIds.contains($0.id) }
        guard !selected.isEmpty else { return }
        shareItems = ReportHelper.buildShareItems(from: selected)
        exitSelectionMode()
    }
}

#if DEBUG
#Preview("RequestList — Empty") {
    RequestListView(onDismiss: {})
}
#Preview("RequestList — With Data") {
    PreviewData.batch.forEach { HakkaInterceptor.shared.store.add($0) }
    return RequestListView(onDismiss: {})
}
#endif
#endif // canImport(UIKit)
