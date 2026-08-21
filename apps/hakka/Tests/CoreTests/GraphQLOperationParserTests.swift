import Testing

@testable import HakkaCore

@Suite("GraphQLOperationParser")
struct GraphQLOperationParserTests {
    @Test func anonymousShorthandQueryHasNoNamedOperations() {
        let source = "{ me { id name } }"
        #expect(GraphQLOperationParser.namedOperations(in: source).isEmpty)
    }

    @Test func anonymousExplicitQueryHasNoName() {
        let source = "query { me { id } }"
        let operations = GraphQLOperationParser.operations(in: source)
        #expect(operations.count == 1)
        #expect(operations.first?.name == nil)
        #expect(operations.first?.keyword == "query")
    }

    @Test func multipleNamedOperationsAreAllFound() {
        let source = """
        query GetUser($id: ID!) { user(id: $id) { name } }
        mutation UpdateUser($id: ID!, $name: String!) { updateUser(id: $id, name: $name) { id } }
        query GetPosts { posts { id } }
        """
        #expect(GraphQLOperationParser.namedOperations(in: source) == ["GetUser", "UpdateUser", "GetPosts"])
    }

    @Test func mixOfAnonymousAndNamedKeepsOnlyNamedInPicker() {
        let source = "query { me } mutation DoThing { doThing }"
        let operations = GraphQLOperationParser.operations(in: source)
        #expect(operations.map(\.name) == [nil, "DoThing"])
        #expect(GraphQLOperationParser.namedOperations(in: source) == ["DoThing"])
    }

    /// The exact hostile case the picker exists to get right: the literal
    /// word "query" sitting inside a string default value must never be
    /// mistaken for the `query` keyword starting a second operation.
    @Test func theWordQueryInsideAStringLiteralIsNotAKeyword() {
        let source = #"""
        query Search($q: String = "a query string") {
            search(q: $q) { id }
        }
        """#
        let operations = GraphQLOperationParser.operations(in: source)
        #expect(operations.count == 1)
        #expect(operations.first?.name == "Search")
    }

    /// Same hazard inside a block string, and a `{`/`}` inside that block
    /// string must not perturb brace-depth tracking either.
    @Test func blockStringContainingQueryAndBracesIsIgnored() {
        let source = #"""
        query Docs {
            docs(description: """
            Example: query { field } — not a real operation.
            """) { id }
        }
        query Second { second }
        """#
        let operations = GraphQLOperationParser.operations(in: source)
        #expect(operations.map(\.name) == ["Docs", "Second"])
    }

    @Test func hashCommentMentioningQueryIsIgnored() {
        let source = """
        # this comment mentions query and mutation but starts nothing
        query Real { real }
        """
        #expect(GraphQLOperationParser.namedOperations(in: source) == ["Real"])
    }

    /// A field named `query`/`mutation` nested inside a real operation must
    /// not be read as a second top-level definition — only depth-0 keywords
    /// count.
    @Test func nestedFieldNamedQueryIsNotASecondOperation() {
        let source = "query Outer { query { nested } }"
        let operations = GraphQLOperationParser.operations(in: source)
        #expect(operations.count == 1)
        #expect(operations.first?.name == "Outer")
    }

    @Test func emptySourceHasNoOperations() {
        #expect(GraphQLOperationParser.operations(in: "").isEmpty)
    }
}
