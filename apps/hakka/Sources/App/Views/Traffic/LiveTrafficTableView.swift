import HakkaCommon
import HakkaCore
import SwiftUI

/// Table display mode: the same captured requests as `LiveTrafficListView`'s
/// list, laid out as a real macOS `Table` so columns resize by dragging the
/// header divider — free from `Table` itself, no hand-rolled drag gesture
/// needed. Which columns show and their order comes from
/// `TrafficColumnConfigStore` via `TableColumnForEach`, SwiftUI's dynamic-
/// column entry point for exactly this case (a data-driven set of columns
/// rather than a fixed static list).
///
/// The one thing `Table` does not do cleanly is `LiveTrafficRowView`'s
/// full-row 2px severity stripe: each column renders an isolated cell, so a
/// decoration spanning outside one column's bounds — one that would also
/// need to track whichever column currently sits first, since columns
/// reorder — has no home in the column-content API. Table mode signals
/// severity the other way DESIGN.md's colour-budget rule already permits
/// outside the stripe context: the status cell's text takes the same
/// chili/turmeric color the stripe would have used, so the signal survives
/// as one cue instead of stripe-plus-color. That is the real cost of
/// choosing `Table` here, and it is judged worth it for what free resizing,
/// reordering, and a picker return in exchange.
struct LiveTrafficTableView: View {
    @Environment(AppModel.self) private var model

    /// Native cell height only just clears `Fmt`'s caption text at default
    /// type size; `.frame(minHeight:)` on every column's content is what
    /// pins the row to DESIGN's 28pt row density, since `Table` sizes each
    /// row to its tallest cell.
    private static let rowHeight: CGFloat = 28

    private var columnConfig: TrafficColumnConfigStore { model.traffic.columnConfig }

    var body: some View {
        Table(model.traffic.visibleRequests, selection: selectionBinding) {
            TableColumnForEach(columnConfig.visibleColumnsInOrder) { column in
                TableColumn(column.title) { request in
                    cell(for: column, request: request)
                }
                .width(min: minWidth(for: column), ideal: idealWidth(for: column))
            }
        }
    }

    /// `Table` only offers `Set<ID>` selection, no single-optional-ID
    /// overload the way `List` has — the model only tracks one selected
    /// request (the detail pane shows exactly one), so this narrows to that
    /// on write and widens back to a singleton set on read.
    private var selectionBinding: Binding<Set<String>> {
        Binding(
            get: { Set(model.traffic.selectedRequestID.map { [$0] } ?? []) },
            set: { model.traffic.selectedRequestID = $0.first },
        )
    }

    @ViewBuilder
    private func cell(for column: TrafficColumn, request: NetworkRequest) -> some View {
        content(for: column, request: request)
            .frame(minHeight: Self.rowHeight, alignment: .leading)
            .contextMenu { rowContextMenu(for: request) }
    }

    @ViewBuilder
    private func content(for column: TrafficColumn, request: NetworkRequest) -> some View {
        switch column {
        case .method:
            Text(request.method.rawValue)
                .font(.caption.monospaced().weight(.bold))
                .foregroundStyle(Fmt.methodColor(request.method))
        case .path:
            Text(Self.path(for: request))
                .font(.caption.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)
        case .host:
            Text(TrafficQueryCompiler.requestHost(request))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        case .status:
            Text(request.status.map(String.init) ?? "–")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Fmt.statusColor(request.status))
        case .duration:
            Text(Fmt.duration(request.duration))
                .font(.caption)
                .foregroundStyle(.secondary)
        case .size:
            Text(Fmt.bytes(request.responseBodySize))
                .font(.caption)
                .foregroundStyle(.secondary)
        case .device:
            if let label = model.traffic.deviceLabel(for: request.id) {
                DeviceTagView(label: label)
            } else {
                Text("–")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    @ViewBuilder
    private func rowContextMenu(for request: NetworkRequest) -> some View {
        Button("Save to Collection") { model.saveCaptured(request) }
        Button("Compare with Selected") { model.traffic.comparisonBaselineID = request.id }
            .disabled(!canCompare(with: request))
    }

    private func canCompare(with request: NetworkRequest) -> Bool {
        guard let selected = model.traffic.selectedRequestID else { return false }
        return selected != request.id
    }

    /// The URL's path (plus query, when present) — `host` already carries
    /// the authority, so `path` should not repeat it. Falls back to the raw
    /// URL when it doesn't parse, same defensiveness as
    /// `TrafficQueryCompiler.requestHost`.
    private static func path(for request: NetworkRequest) -> String {
        guard let components = URLComponents(string: request.url) else { return request.url }
        let path = components.path.isEmpty ? "/" : components.path
        guard let query = components.query, !query.isEmpty else { return path }
        return "\(path)?\(query)"
    }

    private func minWidth(for column: TrafficColumn) -> CGFloat {
        switch column {
        case .method: 50
        case .path: 160
        case .host: 100
        case .status: 44
        case .duration: 56
        case .size: 56
        case .device: 48
        }
    }

    private func idealWidth(for column: TrafficColumn) -> CGFloat {
        switch column {
        case .method: 64
        case .path: 320
        case .host: 160
        case .status: 56
        case .duration: 72
        case .size: 72
        case .device: 64
        }
    }
}
