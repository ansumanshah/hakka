// @generated — do not edit. Synced from ios/Sources/UI/List/FilterBar.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif

// MARK: - Filter Bar

/// Collapsed filter model: search + method chips + a "Filters +n" disclosure
/// — nothing else inline. Status-class chips, domain chips, and sort/group
/// all live behind the disclosure; the "+n" badge is the tell that filters
/// are active while it's collapsed.
struct FilterBar: View {
    @Binding var filterText: String
    var requests: [NetworkRequest] = []
    @Binding var selectedDomains: Set<String>
    @Binding var selectedMethods: Set<String>
    @Binding var selectedStatusGroup: String?
    @Binding var sortField: SortField
    @Binding var sortAscending: Bool
    @Binding var groupBy: GroupBy

    @State private var isExpanded = false
    @State private var showPresets = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if #available(iOS 26.0, *) {
                GlassEffectContainer(spacing: Theme.s8) {
                    filterContent
                }
            } else {
                filterContent
            }
        }
        .padding(.horizontal, HakkaMetrics.Layout.gutter)
        .padding(.vertical, Theme.s8)
        .background(Theme.surfaceRaised)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.border.opacity(0.45)).frame(height: 0.5) // ui-token-check-ignore: separator rail geometry
        }
        .sheet(isPresented: $showPresets) {
            FilterPresetsSheet(
                currentPreset: currentPreset,
                onApply: applyPreset
            )
            .presentationDetents([.medium, .large])
        }
    }

    private var filterContent: some View {
        VStack(spacing: Theme.s8) {
            searchField
            // Methods are the one always-visible quick-chip row; the
            // "Filters +n" trigger pins to the trailing edge so it never
            // scrolls out of reach.
            methodsRow
            if isExpanded {
                filterChips
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
    }

    // MARK: - Methods row + Filters disclosure trigger

    private var methodsRow: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Theme.s6) {
                    methodScroller
                    filtersDisclosureTrigger
                }
            } else {
                HStack(spacing: Theme.s8) {
                    methodScroller
                    filtersDisclosureTrigger
                }
            }
        }
    }

    private var methodScroller: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.s6) {
                ForEach(["GET", "POST", "PUT", "PATCH", "DELETE"], id: \.self) { method in
                    HakkaChip(
                        label: method,
                        isActive: selectedMethods.contains(method),
                        tone: Theme.methodColor(for: HttpMethod(rawValue: method) ?? .get)
                    ) {
                        toggleMethod(method)
                    }
                }
            }
        }
    }

    /// "Filters +n" — action-bar height (`ctlHLg`), never a bare chevron: the
    /// label makes it discoverable, the count makes it honest about what's
    /// hidden while collapsed.
    private var filtersDisclosureTrigger: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
        } label: {
            HStack(spacing: Theme.s4) {
                Image(systemName: "line.3.horizontal.decrease.circle")
                    .font(.caption2)
                Text("Filters")
                    .font(.caption2.weight(.semibold))
                if disclosureFilterCount > 0 {
                    Text("\(disclosureFilterCount)")
                        .font(.system(size: HakkaMetrics.FontSize.xxs, weight: .bold, design: .monospaced))
                        .padding(.horizontal, HakkaMetrics.Spacing.xs)
                        .frame(minWidth: 14, minHeight: 14)  // ui-token-check-ignore: multi-line editor bounds — content box, not a control
                        .background(Theme.accent)
                        .foregroundStyle(.white)
                        .clipShape(Capsule())
                }
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 8, weight: .semibold))  // ui-token-check-ignore: one-off glyph/micro-label size, outside the type scale
            }
            .foregroundStyle(disclosureFilterCount > 0 ? Theme.accent : Theme.textSecondary)
            .padding(.horizontal, Theme.s10)
            .frame(height: Theme.ctlHLg)
            .background(Theme.surface.opacity(0.72))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusM)
                    .stroke(disclosureFilterCount > 0 ? Theme.accent.opacity(0.4) : Theme.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .frame(minHeight: Theme.tapMin)
        .accessibilityLabel(Text("Filters, \(disclosureFilterCount) active"))
    }

    /// Count behind the "+n" badge: status class, domains, and any non-default
    /// sort/group — everything currently folded behind the disclosure.
    private var disclosureFilterCount: Int {
        var n = 0
        if selectedStatusGroup != nil { n += 1 }
        n += selectedDomains.count
        if sortField != .time || sortAscending { n += 1 }
        if groupBy != .none { n += 1 }
        return n
    }

    private static let statusChips = ["1xx", "2xx", "3xx", "4xx", "5xx"]

    /// Status-class semantic tones — chili for 5xx, turmeric for 4xx, steel
    /// for 3xx/info, jade for 2xx, pending-gray for 1xx (DESIGN.md kitchen palette).
    private func statusChipTone(_ chip: String) -> Color {
        switch chip {
        case "1xx": return Theme.pending
        case "2xx": return Theme.success
        case "3xx": return Theme.info
        case "4xx": return Theme.warning
        case "5xx": return Theme.error
        default: return Theme.textTertiary
        }
    }

    // MARK: - Current Preset Snapshot

    private var currentPreset: FilterPreset {
        FilterPreset(
            searchQuery: filterText,
            methodFilters: selectedMethods,
            statusGroup: selectedStatusGroup,
            sortField: sortField,
            sortAscending: sortAscending,
            groupBy: groupBy
        )
    }

    private func applyPreset(_ preset: FilterPreset) {
        filterText = preset.searchQuery
        selectedMethods = preset.methodFilters
        selectedStatusGroup = preset.statusGroup
        sortField = preset.sortField
        sortAscending = preset.sortAscending
        groupBy = preset.groupBy
        // collapse domains when applying a preset (domain filter not in preset model)
        selectedDomains = []
    }

    // MARK: - Search Field

    private var searchField: some View {
        HStack(spacing: Theme.s8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.textTertiary)
                .font(.footnote)
            TextField("Search or filter\u{2026}", text: $filterText)
                .textFieldStyle(.plain)
                .font(.footnote)
                .foregroundStyle(Theme.text)
                .accessibilityHint(Text("Supports url:, header:, body:, glob, regex, and -negate syntax"))

            if !filterText.isEmpty {
                Button(action: { filterText = "" }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.textTertiary)
                        .font(.footnote)
            }
            .buttonStyle(.plain)
            .hakkaIconTarget()
        }

            // Presets button — bookmark icon. The "Filters +n" disclosure
            // trigger lives in the methods row below, not duplicated here.
            Button(action: { showPresets = true }) {
                Image(systemName: "bookmark")
                    .foregroundStyle(hasActiveFilters ? Theme.accent : Theme.textTertiary)
                    .font(.footnote)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Filter presets"))
        }
        .padding(.horizontal, Theme.s12)
        .frame(minHeight: HakkaMetrics.ControlHeight.nav)
        .hakkaGlassSurface(
            tint: hasActiveFilters ? Theme.accent.opacity(0.18) : Theme.controlTint,
            cornerRadius: Theme.radiusL,
            interactive: true
        )
    }

    // MARK: - Filters Disclosure
    //
    // Everything except search + methods lives here: status class, domain,
    // and sort/group — collapsed by default, revealed inline (not a second
    // sheet) when "Filters +n" is tapped.

    private var filterChips: some View {
        VStack(alignment: .leading, spacing: Theme.s10) {
            statusClassRow

            if !domainList.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.s6) {
                        ForEach(domainList, id: \.self) { domain in
                            HakkaChip(label: domain, isActive: selectedDomains.contains(domain), tone: Theme.info, mono: false) {
                                toggleDomain(domain)
                            }
                        }
                    }
                }
            }

            Divider().overlay(Theme.border.opacity(0.5))

            SortGroupBar(sortField: $sortField, sortAscending: $sortAscending, groupBy: $groupBy)
        }
        .padding(Theme.s8)
        .hakkaGlassSurface(tint: Theme.controlTint, cornerRadius: Theme.radiusL)
    }

    private var statusClassRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.s6) {
                ForEach(Self.statusChips, id: \.self) { chip in
                    HakkaChip(
                        label: chip,
                        isActive: selectedStatusGroup == chip,
                        tone: statusChipTone(chip)
                    ) {
                        selectedStatusGroup = selectedStatusGroup == chip ? nil : chip
                    }
                    .accessibilityLabel(Text("Only \(chip) responses"))
                }
            }
        }
    }

    // MARK: - Helpers

    private var domainList: [String] {
        let domains = Set(requests.compactMap { URL(string: $0.url)?.host })
        return domains.sorted()
    }

    private func toggleDomain(_ domain: String) {
        if selectedDomains.contains(domain) {
            selectedDomains.remove(domain)
        } else {
            selectedDomains.insert(domain)
        }
    }

    private func toggleMethod(_ method: String) {
        if selectedMethods.contains(method) {
            selectedMethods.remove(method)
        } else {
            selectedMethods.insert(method)
        }
    }

    private var hasActiveFilters: Bool {
        !filterText.isEmpty || !selectedDomains.isEmpty || !selectedMethods.isEmpty || selectedStatusGroup != nil
    }
}

// MARK: - FilterPresetsSheet

/// Sheet showing recent and saved filter presets. Lets the user apply, save, or remove presets.
struct FilterPresetsSheet: View {
    let currentPreset: FilterPreset
    let onApply: (FilterPreset) -> Void

    @ObservedObject private var store = FilterPresetStore.shared
    @Environment(\.dismiss) private var dismiss

    @State private var saveNameText = ""
    @State private var showSaveField = false

    var body: some View {
        NavigationView {
            List {
                // MARK: Save Current
                Section {
                    if showSaveField {
                        HStack(spacing: Theme.s8) {
                            TextField("Preset name", text: $saveNameText)
                                .textFieldStyle(.plain)
                                .font(.footnote)
                                .foregroundStyle(Theme.text)
                                .submitLabel(.done)
                                .onSubmit { commitSave() }
                            Button("Save") { commitSave() }
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(saveNameText.isEmpty ? Theme.textTertiary : Theme.info)
                                .disabled(saveNameText.isEmpty)
                                .buttonStyle(.plain)
                        }
                    } else {
                        Button {
                            withAnimation { showSaveField = true }
                        } label: {
                            Label("Save current filter", systemImage: "bookmark.fill")
                                .font(.footnote)
                                .foregroundStyle(currentPreset.isEmpty ? Theme.textTertiary : Theme.info)
                        }
                        .disabled(currentPreset.isEmpty)
                    }
                } header: {
                    Text("Current Filter")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Theme.textSecondary)
                }

                // MARK: Saved Presets
                if !store.saved.isEmpty {
                    Section {
                        ForEach(store.saved, id: \.name) { named in
                            Button {
                                store.pushRecent(named.preset)
                                onApply(named.preset)
                                dismiss()
                            } label: {
                                HStack(spacing: Theme.s8) {
                                    Image(systemName: "bookmark.fill")
                                        .font(.caption2)
                                        .foregroundStyle(Theme.info)
                                    VStack(alignment: .leading, spacing: HakkaMetrics.Spacing.xxs) {
                                        Text(named.name)
                                            .font(.footnote.weight(.medium))
                                            .foregroundStyle(Theme.text)
                                        Text(presetSummary(named.preset))
                                            .font(.caption2)
                                            .foregroundStyle(Theme.textSecondary)
                                    }
                                    Spacer()
                                }
                            }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    store.remove(name: named.name)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    } header: {
                        Text("Saved")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }

                // MARK: Recent
                if !store.recent.isEmpty {
                    Section {
                        ForEach(Array(store.recent.enumerated()), id: \.offset) { _, preset in
                            Button {
                                onApply(preset)
                                dismiss()
                            } label: {
                                HStack(spacing: Theme.s8) {
                                    Image(systemName: "clock")
                                        .font(.caption2)
                                        .foregroundStyle(Theme.textTertiary)
                                    Text(presetSummary(preset))
                                        .font(.footnote)
                                        .foregroundStyle(Theme.text)
                                    Spacer()
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    } header: {
                        Text("Recent")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Filter Presets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func commitSave() {
        let name = saveNameText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        store.save(name: name, preset: currentPreset)
        saveNameText = ""
        showSaveField = false
        Haptics.light()
    }

    /// Human-readable one-line summary of a preset.
    private func presetSummary(_ preset: FilterPreset) -> String {
        var parts: [String] = []
        if !preset.searchQuery.isEmpty { parts.append("\"\(preset.searchQuery)\"") }
        if !preset.methodFilters.isEmpty { parts.append(preset.methodFilters.sorted().joined(separator: ",")) }
        if let sg = preset.statusGroup { parts.append(sg) }
        if preset.groupBy != .none { parts.append("group:\(preset.groupBy.rawValue)") }
        if preset.sortField != .time || preset.sortAscending {
            parts.append("sort:\(preset.sortField.rawValue)")
        }
        return parts.isEmpty ? "(default)" : parts.joined(separator: " · ")
    }
}

#if DEBUG
private struct FilterBarPreview: View {
    @State private var text = ""
    @State private var domains: Set<String> = []
    @State private var methods: Set<String> = []
    @State private var status: String? = nil
    @State private var sort: SortField = .time
    @State private var asc = false
    @State private var group: GroupBy = .none

    var body: some View {
        VStack(spacing: 0) {
            FilterBar(
                filterText: $text,
                requests: PreviewData.batch,
                selectedDomains: $domains,
                selectedMethods: $methods,
                selectedStatusGroup: $status,
                sortField: $sort,
                sortAscending: $asc,
                groupBy: $group
            )
            Spacer()
        }
        .background(Theme.bg)
    }
}

#Preview("FilterBar") { FilterBarPreview() }
#endif
#endif // canImport(UIKit)
