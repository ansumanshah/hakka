import AppKit
import HakkaCommon
import HakkaCore
import SwiftUI

/// The GraphQL tab: operation type/name, the raw query text, pretty-printed
/// variables, and the full response body — the request/response pair's
/// GraphQL shape in one place instead of flipping between Request and
/// Response. Reachable only when `DetailTab.visible` found a
/// `graphqlOperationName` on the record. Mirrors the iOS inspector's
/// `GraphQLDetailView` (`ios/Sources/UI/Detail/GraphQLDetailView.swift`),
/// except the response side reuses the desktop's own `BodyViewerView`
/// (pretty/tree/search) rather than a hand-parsed errors list.
struct DetailGraphQLTabView: View {
    let record: NetworkRequest

    /// Envelope fields pulled from the request body's JSON — `query` here is
    /// still raw GraphQL source, not validated document structure.
    private let requestInfo: GraphQLBodyParser.GraphQLBodyInfo?
    private let responseBody: RecordBody?

    /// Operation definitions found in the query text via the same parser the
    /// request-authoring editor uses for its operation-name picker — a more
    /// accurate keyword (query/mutation/subscription) than
    /// `GraphQLBodyParser`'s "starts with mutation/subscription" guess, and
    /// the only way to pick the right operation out of a multi-operation
    /// document by name.
    private let operations: [GraphQLOperationParser.Operation]

    init(record: NetworkRequest) {
        self.record = record
        let info = GraphQLBodyParser.parse(record.requestBody)
        requestInfo = info
        operations = GraphQLOperationParser.operations(in: info?.query ?? "")
        responseBody = RecordBodyExtractor.responseBody(from: record)
    }

    /// The operation actually executed: matched by name when the request
    /// named one (multi-operation documents send `operationName` alongside
    /// the full document), otherwise the document's only definition.
    private var activeOperation: GraphQLOperationParser.Operation? {
        guard let name = record.graphqlOperationName else { return operations.first }
        return operations.first { $0.name == name } ?? operations.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            operationSection
            if let query = requestInfo?.query, !query.isEmpty {
                GraphQLCodeSection(title: "Query", text: query)
            }
            if let variables = requestInfo?.variablesJSON, !variables.isEmpty {
                GraphQLCodeSection(title: "Variables", text: variables)
            }
            responseSection
        }
    }

    private var operationSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            sectionTitle("Operation")
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                operationRow("Type", activeOperation?.keyword ?? requestInfo?.operationType ?? "query")
                operationRow("Name", activeOperation?.name ?? record.graphqlOperationName ?? "(anonymous)")
            }
            .padding(Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }

    private func operationRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Text(label)
                .font(.caption.weight(.medium))
                .frame(width: 140, alignment: .leading)
            Text(value)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }

    @ViewBuilder
    private var responseSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            sectionTitle("Response")
            if let responseBody {
                BodyViewerView(body: responseBody, url: record.url, responseHeaders: record.responseHeaders)
            } else {
                Text("No response body")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Spacing.md)
                    .background(Color.secondary.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
    }
}

/// One monospaced, selectable, copyable code block — the query text or the
/// pretty-printed variables JSON. `.contextMenu` is the copy affordance per
/// `swiftui-patterns.md`, matching `StorageEntryRow`.
private struct GraphQLCodeSection: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(text)
                .font(.caption.monospaced())
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Spacing.lg)
                .background(Color.secondary.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .contentShape(Rectangle())
                .contextMenu {
                    Button("Copy \(title)") { copy(text) }
                }
        }
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}
