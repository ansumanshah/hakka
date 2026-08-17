#if canImport(UIKit)
import SwiftUI
import HakkaCommon
import UIKit

// MARK: - SortField

enum SortField: String, CaseIterable {
    case time = "Time"
    case duration = "Duration"
    case size = "Size"
    case status = "Status"
}

// MARK: - GroupBy

enum GroupBy: String, CaseIterable {
    case none = "None"
    case host = "Host"
    case statusClass = "Status"
    case method = "Method"
    case error = "Error"
}

// MARK: - SortGroupBar

/// Horizontal bar showing Sort and Group-by pickers plus sort-direction toggle.
struct SortGroupBar: View {
    @Binding var sortField: SortField
    @Binding var sortAscending: Bool
    @Binding var groupBy: GroupBy

    var body: some View {
        HStack(spacing: Theme.s6) {
            Menu {
                ForEach(SortField.allCases, id: \.self) { field in
                    Button {
                        if sortField == field {
                            sortAscending.toggle()
                        } else {
                            sortField = field
                            sortAscending = false
                        }
                    } label: {
                        Label(
                            field.rawValue,
                            systemImage: sortField == field
                                ? (sortAscending ? "arrow.up" : "arrow.down")
                                : "circle"
                        )
                    }
                }
            } label: {
                HStack(spacing: HakkaMetrics.Spacing.xxs) {
                    Image(systemName: sortAscending ? "arrow.up" : "arrow.down")
                        .font(.system(size: HakkaMetrics.FontSize.xxs, weight: .bold))
                    Text(sortField.rawValue)
                        .font(.caption2.weight(.medium))
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8, weight: .semibold))  // ui-token-check-ignore: one-off glyph/micro-label size, outside the type scale
                }
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, Theme.s8)
                .padding(.vertical, Theme.s4)
                .background(Theme.surface.opacity(0.72))
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)

            Menu {
                ForEach(GroupBy.allCases, id: \.self) { group in
                    Button {
                        groupBy = group
                    } label: {
                        Label(
                            group.rawValue,
                            systemImage: groupBy == group ? "checkmark" : "circle"
                        )
                    }
                }
            } label: {
                HStack(spacing: HakkaMetrics.Spacing.xxs) {
                    Image(systemName: "square.grid.2x2")
                        .font(.system(size: HakkaMetrics.FontSize.xxs, weight: .bold))
                    Text(groupBy == .none ? "Group" : groupBy.rawValue)
                        .font(.caption2.weight(.medium))
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8, weight: .semibold))  // ui-token-check-ignore: one-off glyph/micro-label size, outside the type scale
                }
                .foregroundStyle(groupBy == .none ? Theme.textSecondary : Theme.info)
                .padding(.horizontal, Theme.s8)
                .padding(.vertical, Theme.s4)
                .background(Theme.surface.opacity(0.72))
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)

            Spacer()
        }
        // No side padding of its own — the caller (FilterBar's "Filters +n"
        // disclosure) pads its whole contents once.
        .padding(.vertical, Theme.s4)
    }
}

// MARK: - Sorting + Grouping logic

extension Array where Element == NetworkRequest {

    /// Sort in-memory by `field` (ascending when `ascending == true`).
    func sorted(by field: SortField, ascending: Bool) -> [NetworkRequest] {
        let sorted: [NetworkRequest]
        switch field {
        case .time:
            sorted = self.sorted { $0.startTime < $1.startTime }
        case .duration:
            sorted = self.sorted { ($0.duration ?? Int64.max) < ($1.duration ?? Int64.max) }
        case .size:
            sorted = self.sorted { $0.responseBodySize < $1.responseBodySize }
        case .status:
            sorted = self.sorted { ($0.status ?? 0) < ($1.status ?? 0) }
        }
        return ascending ? sorted : sorted.reversed()
    }

    /// Group requests. Each tuple is `(groupLabel, requests)`.
    func grouped(by groupBy: GroupBy) -> [(label: String, requests: [NetworkRequest])] {
        switch groupBy {
        case .none:
            return [("", self)]
        case .host:
            return grouping { URL(string: $0.url)?.host ?? "unknown" }
        case .statusClass:
            return grouping { statusClass($0.status) }
        case .method:
            return grouping { $0.method.rawValue }
        case .error:
            return grouping { $0.error != nil || ($0.status ?? 0) >= 400 ? "Errors" : "OK" }
        }
    }

    private func grouping(keyFor keyFn: (NetworkRequest) -> String) -> [(label: String, requests: [NetworkRequest])] {
        var order: [String] = []
        var dict: [String: [NetworkRequest]] = [:]
        for req in self {
            let key = keyFn(req)
            if dict[key] == nil {
                order.append(key)
                dict[key] = []
            }
            dict[key]!.append(req)
        }
        return order.map { label in (label: label, requests: dict[label]!) }
    }

    private func statusClass(_ status: Int?) -> String {
        guard let s = status else { return "Pending" }
        switch s {
        case 100..<200: return "1xx"
        case 200..<300: return "2xx"
        case 300..<400: return "3xx"
        case 400..<500: return "4xx"
        case 500..<600: return "5xx"
        default: return "Other"
        }
    }
}

// MARK: - GroupSectionHeader

struct GroupSectionHeader: View {
    let label: String
    let count: Int

    var body: some View {
        HStack(spacing: Theme.s6) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.text)
            Text("\(count)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.textTertiary)
            Spacer()
        }
        .padding(.horizontal, Theme.s4)
        .padding(.top, Theme.s8)
        .padding(.bottom, Theme.s2)
    }
}

#if DEBUG
private struct SortGroupBarPreviewWrapper: View {
    @State private var sortField = SortField.time
    @State private var sortAscending = false
    @State private var groupBy = GroupBy.none

    var body: some View {
        VStack {
            SortGroupBar(sortField: $sortField, sortAscending: $sortAscending, groupBy: $groupBy)
        }
        .padding(.horizontal, Theme.s16)
        .background(Theme.bg)
    }
}

#Preview("SortGroupBar") {
    SortGroupBarPreviewWrapper()
}
#endif
#endif // canImport(UIKit)
