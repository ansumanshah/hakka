// @generated — do not edit. Synced from ios/Sources/UI/Detail/GraphQLDetailView.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
#if canImport(HakkaCommon)
import HakkaCommon
#endif
import SwiftUI
import UIKit

// MARK: - GraphQLDetailView

/// Card shown in the graphql tab when a request has GraphQL info.
/// Mirrors the RN/web GraphQLTab: operation type+name, variables (pretty JSON),
/// and errors parsed from the response body `errors` array.
struct GraphQLDetailView: View {
    let request: NetworkRequest

    private var parsedInfo: GraphQLBodyParser.GraphQLBodyInfo? {
        GraphQLBodyParser.parse(request.requestBody)
    }
    private var errors: [GraphQLBodyParser.GraphQLResponseError] {
        GraphQLBodyParser.parseErrors(request.responseBody)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.s12) {
            operationCard
            if let query = parsedInfo?.query, !query.isEmpty {
                queryCard(query)
            }
            if let variables = parsedInfo?.variablesJSON, !variables.isEmpty {
                variablesCard(variables)
            }
            errorsCard
        }
    }

    // MARK: - Operation

    private var operationCard: some View {
        overviewCard("Operation") {
            KeyValueRow(
                key: "Type",
                value: parsedInfo?.operationType ?? "query",
                keyColor: Theme.info.opacity(0.9),
                valueColor: Theme.methodPatch
            )
            KeyValueRow(
                key: "Name",
                value: request.graphqlOperationName ?? "(anonymous)",
                keyColor: Theme.info.opacity(0.9),
                valueColor: Theme.text
            )
        }
    }

    // MARK: - Query

    private func queryCard(_ query: String) -> some View {
        overviewCard("Query") {
            SearchHighlightedText(
                text: query,
                font: .caption2.monospaced(),
                color: Theme.text,
                lineLimit: 40
            )
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.s8)
            .background(Theme.surfaceRaised)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
            .contentShape(Rectangle())
            .contextMenu {
                Button {
                    UIPasteboard.general.string = query
                    Haptics.light()
                } label: {
                    Label("Copy Query", systemImage: "doc.on.doc")
                }
            }
        }
    }

    // MARK: - Variables

    private func variablesCard(_ json: String) -> some View {
        overviewCard("Variables") {
            SearchHighlightedText(
                text: json,
                font: .caption2.monospaced(),
                color: Theme.text,
                lineLimit: 20
            )
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.s8)
            .background(Theme.surfaceRaised)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
            .contentShape(Rectangle())
            .contextMenu {
                Button {
                    UIPasteboard.general.string = json
                    Haptics.light()
                } label: {
                    Label("Copy Variables", systemImage: "doc.on.doc")
                }
            }
        }
    }

    // MARK: - Errors

    private var errorsCard: some View {
        overviewCard(errors.isEmpty ? "Errors" : "Errors (\(errors.count))") {
            if errors.isEmpty {
                Text("No errors")
                    .font(.caption2)
                    .foregroundStyle(Theme.textTertiary)
            } else {
                ForEach(Array(errors.enumerated()), id: \.offset) { _, err in
                    VStack(alignment: .leading, spacing: Theme.s2) {
                        Text(err.message)
                            .font(.caption2.monospaced())
                            .foregroundStyle(Theme.error)
                            .textSelection(.enabled)
                        if let path = err.path, !path.isEmpty {
                            Text("@ \(path)")
                                .font(.caption2.monospaced())
                                .foregroundStyle(Theme.textTertiary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    // MARK: - Layout helper

    @ViewBuilder
    private func overviewCard<C: View>(_ title: String, @ViewBuilder content: @escaping () -> C) -> some View {
        OverviewCard(title: title, content: content)
    }
}

#if DEBUG
#Preview("GraphQL — with errors") {
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    let req = NetworkRequest(
        id: "gql1",
        url: "https://api.example.com/graphql",
        method: .post,
        status: 200,
        startTime: now - 500,
        duration: 120,
        requestBody: """
        {"operationName":"GetUser","query":"query GetUser($id: ID!) { user(id: $id) { name email } }","variables":{"id":"42","role":"admin"}}
        """,
        responseBody: """
        {"data":null,"errors":[{"message":"User not found","path":["user"]},{"message":"Permission denied"}]}
        """,
        graphqlOperationName: "GetUser"
    )
    return ScrollView {
        GraphQLDetailView(request: req)
            .padding(Theme.s16)
    }
    .background(Theme.bg)
}
#Preview("GraphQL — no errors") {
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    let req = NetworkRequest(
        id: "gql2",
        url: "https://api.example.com/graphql",
        method: .post,
        status: 200,
        startTime: now - 300,
        duration: 85,
        requestBody: """
        {"operationName":"CreatePost","query":"mutation CreatePost($title: String!) { createPost(title: $title) { id } }","variables":{"title":"Hello"}}
        """,
        responseBody: """
        {"data":{"createPost":{"id":"101"}}}
        """,
        graphqlOperationName: "CreatePost"
    )
    return ScrollView {
        GraphQLDetailView(request: req)
            .padding(Theme.s16)
    }
    .background(Theme.bg)
}
#endif
#endif // canImport(UIKit)
