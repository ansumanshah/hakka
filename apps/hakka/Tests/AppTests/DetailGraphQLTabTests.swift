import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// `DetailTab.visible(for:)` gates the GraphQL tab on `graphqlOperationName`
/// — set only when the request body parsed as a named or matched GraphQL
/// operation (see `HakkaInterceptor.extractGraphQLOperationName`), so an
/// ordinary REST request never grows an empty GraphQL tab.
@Suite("DetailTab GraphQL visibility")
struct DetailGraphQLTabTests {
    private func request(graphqlOperationName: String? = nil) -> NetworkRequest {
        NetworkRequest(
            url: "https://api.example.com/graphql",
            method: .post,
            status: 200,
            startTime: 0,
            requestBody: """
            {"operationName":"GetUser","query":"query GetUser($id: ID!) { user(id: $id) { name } }","variables":{"id":"42"}}
            """,
            responseBody: """
            {"data":{"user":{"name":"Ada"}}}
            """,
            graphqlOperationName: graphqlOperationName,
        )
    }

    @Test func graphqlTabHiddenWhenRecordIsNotGraphQL() {
        let tabs = DetailTab.visible(for: request())
        #expect(!tabs.contains(.graphql))
    }

    @Test func graphqlTabAppearsWhenRecordCarriesAnOperationName() {
        let tabs = DetailTab.visible(for: request(graphqlOperationName: "GetUser"))
        #expect(tabs.contains(.graphql))
    }

    @Test func graphqlTabComesRightAfterTheBaseFourTabs() {
        let tabs = DetailTab.visible(for: request(graphqlOperationName: "GetUser"))
        #expect(tabs == [.overview, .request, .response, .timing, .graphql])
    }

    /// Query/variables/response extraction feeding `DetailGraphQLTabView`
    /// relies on `GraphQLOperationParser` matching the record's
    /// `graphqlOperationName` against the document's operation definitions —
    /// exercised here at the parser level, since the view itself needs no
    /// UI-level test to prove this wiring.
    @Test func operationParserFindsTheNamedOperationInTheRequestQuery() {
        let query = "query GetUser($id: ID!) { user(id: $id) { name } }"
        let operations = GraphQLOperationParser.operations(in: query)
        #expect(operations == [GraphQLOperationParser.Operation(keyword: "query", name: "GetUser")])
    }
}
