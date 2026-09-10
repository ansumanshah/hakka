import HakkaCore
import SwiftUI

/// The collection's working surface. A populated project opens requests from a
/// native table; an empty project presents only the actions needed to begin.
struct ProjectOverviewView: View {
    @Environment(AppModel.self) private var model
    @State private var searchText = ""

    var body: some View {
        VStack(spacing: 0) {
            commandBar
            Divider()

            if requestRows.isEmpty {
                emptyProject
            } else {
                requestTable
                    .searchable(text: $searchText, prompt: "Find requests")
            }
        }
        .navigationTitle("Requests")
    }

    private var commandBar: some View {
        HStack(spacing: Spacing.sm) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text("Requests")
                    .font(.headline)
                Text(requestCountText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button {
                Task { await model.openCollectionDirectory() }
            } label: {
                Label(model.collection.directoryURL == nil ? "Open" : "Open Another", systemImage: "folder")
            }
            .controlSize(.small)

            Button {
                model.select(.proxy)
            } label: {
                Label("Capture", systemImage: "record.circle")
            }
            .controlSize(.small)

            Button {
                model.newRequest()
            } label: {
                Label("New Request", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
        .padding(.horizontal, Layout.gutter)
        .frame(minHeight: ControlHeight.bar)
    }

    private var requestTable: some View {
        Table(filteredRows, selection: requestSelection) {
            TableColumn("Method") { row in
                Text(row.request.method.rawValue)
                    .font(.caption.monospaced().weight(.bold))
                    .foregroundStyle(Fmt.methodColor(row.request.method))
            }
            .width(56)

            TableColumn("Name") { row in
                Text(row.request.name)
                    .lineLimit(1)
            }
            .width(min: 140, ideal: 220)

            TableColumn("URL") { row in
                Text(row.request.url.isEmpty ? "No URL" : row.request.url)
                    .font(.caption.monospaced())
                    .foregroundStyle(row.request.url.isEmpty ? .tertiary : .secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .width(min: 220, ideal: 420)

            TableColumn("Folder") { row in
                Text(row.folderPath ?? "—")
                    .font(.caption)
                    .foregroundStyle(row.folderPath == nil ? .tertiary : .secondary)
                    .lineLimit(1)
            }
            .width(min: 100, ideal: 160)
        }
        .scrollContentBackground(.hidden)
        .background(Color(nsColor: .textBackgroundColor))
    }

    private var emptyProject: some View {
        ContentUnavailableView {
            Label("No requests", systemImage: "square.stack.3d.up")
        } description: {
            Text("Create a request or open a collection to begin.")
        } actions: {
            HStack {
                Button("Open Collection…") {
                    Task { await model.openCollectionDirectory() }
                }
                Button("New Request") {
                    model.newRequest()
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }

    private var requestRows: [RequestRow] {
        Self.flatten(model.collection.collection.nodes)
    }

    private var filteredRows: [RequestRow] {
        guard !searchText.isEmpty else { return requestRows }
        return requestRows.filter { row in
            [row.request.name, row.request.url, row.request.method.rawValue, row.folderPath ?? ""]
                .contains { $0.localizedCaseInsensitiveContains(searchText) }
        }
    }

    private var requestCountText: String {
        let count = requestRows.count
        return "\(count) request\(count == 1 ? "" : "s") in \(model.collection.collection.name)"
    }

    private var requestSelection: Binding<Set<String>> {
        Binding(
            get: { [] },
            set: { ids in
                guard let id = ids.first else { return }
                model.select(.request(id: id))
            }
        )
    }

    private static func flatten(_ nodes: [CollectionNode], path: [String] = []) -> [RequestRow] {
        nodes.flatMap { node -> [RequestRow] in
            switch node {
            case let .request(request):
                return [RequestRow(request: request, folderPath: path.isEmpty ? nil : path.joined(separator: " / "))]
            case let .folder(folder):
                return flatten(folder.children, path: path + [folder.name])
            }
        }
    }
}

private struct RequestRow: Identifiable {
    let request: RequestSpec
    let folderPath: String?

    var id: String { request.id }
}
