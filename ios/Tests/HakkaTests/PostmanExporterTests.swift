import Testing
import Foundation
@testable import HakkaNetwork
@testable import HakkaCommon

// MARK: - PostmanExporterTests

@Suite struct PostmanExporterTests {

    private func req(
        url: String = "https://api.example.com/users",
        method: HttpMethod = .get,
        requestHeaders: [String: [String]] = [:],
        requestBody: String? = nil
    ) -> NetworkRequest {
        NetworkRequest(
            url: url, method: method,
            status: 200, startTime: 1_700_000_000_000, duration: 100,
            requestHeaders: requestHeaders,
            requestBody: requestBody
        )
    }

    // MARK: - Collection shape

    @Test func collectionHasCorrectSchemaAndName() throws {
        let result = PostmanExporter.buildCollection([req()], name: "My Collection")
        let info = try #require(result["info"] as? [String: Any])
        #expect(info["name"] as? String == "My Collection")
        #expect(info["schema"] as? String == "https://schema.getpostman.com/json/collection/v2.1.0/collection.json")
    }

    @Test func defaultNameIsHakkaExport() throws {
        let result = PostmanExporter.buildCollection([req()])
        let info = try #require(result["info"] as? [String: Any])
        #expect(info["name"] as? String == "Hakka Export")
    }

    @Test func itemCountMatchesRequestCount() throws {
        let requests = [
            req(url: "https://example.com/a"),
            req(url: "https://example.com/b"),
            req(url: "https://example.com/c"),
        ]
        let result = PostmanExporter.buildCollection(requests)
        let items = try #require(result["item"] as? [[String: Any]])
        #expect(items.count == 3)
    }

    // MARK: - Item shape

    @Test func itemNameIsMethodPlusPath() throws {
        let item = PostmanExporter.buildItem(req(url: "https://api.example.com/users/42", method: .get))
        #expect(item["name"] as? String == "GET /users/42")
    }

    @Test func itemNameFallsBackToFullUrlForUnparseable() throws {
        let item = PostmanExporter.buildItem(req(url: "not-a-url", method: .post))
        #expect(item["name"] as? String == "POST not-a-url")
    }

    @Test func requestFieldHasCorrectMethod() throws {
        let item = PostmanExporter.buildItem(req(url: "https://example.com/", method: .delete))
        let request = try #require(item["request"] as? [String: Any])
        #expect(request["method"] as? String == "DELETE")
    }

    @Test func requestFieldHasCorrectUrl() throws {
        let item = PostmanExporter.buildItem(req(url: "https://api.example.com/v2/items"))
        let request = try #require(item["request"] as? [String: Any])
        #expect(request["url"] as? String == "https://api.example.com/v2/items")
    }

    @Test func responseArrayIsEmpty() throws {
        let item = PostmanExporter.buildItem(req())
        let response = try #require(item["response"] as? [Any])
        #expect(response.isEmpty)
    }

    // MARK: - Headers

    @Test func singleValueHeaderMapped() throws {
        let r = req(requestHeaders: ["Content-Type": ["application/json"]])
        let item = PostmanExporter.buildItem(r)
        let request = try #require(item["request"] as? [String: Any])
        let headers = try #require(request["header"] as? [[String: String]])
        let ct = headers.first { $0["key"] == "Content-Type" }
        #expect(ct?["value"] == "application/json")
    }

    @Test func multiValueHeaderExpandedToSeparateEntries() throws {
        let r = req(requestHeaders: ["Accept": ["application/json", "text/plain"]])
        let item = PostmanExporter.buildItem(r)
        let request = try #require(item["request"] as? [String: Any])
        let headers = try #require(request["header"] as? [[String: String]])
        let acceptHeaders = headers.filter { $0["key"] == "Accept" }
        #expect(acceptHeaders.count == 2)
    }

    @Test func emptyHeadersProducesEmptyArray() throws {
        let item = PostmanExporter.buildItem(req())
        let request = try #require(item["request"] as? [String: Any])
        let headers = try #require(request["header"] as? [[String: String]])
        #expect(headers.isEmpty)
    }

    // MARK: - Body

    @Test func requestWithBodyHasBodyField() throws {
        let r = req(method: .post, requestBody: "{\"name\":\"test\"}")
        let item = PostmanExporter.buildItem(r)
        let request = try #require(item["request"] as? [String: Any])
        let body = try #require(request["body"] as? [String: Any])
        #expect(body["mode"] as? String == "raw")
        #expect(body["raw"] as? String == "{\"name\":\"test\"}")
    }

    @Test func requestWithoutBodyHasNoBodyField() throws {
        let item = PostmanExporter.buildItem(req())
        let request = try #require(item["request"] as? [String: Any])
        #expect(request["body"] == nil)
    }

    @Test func requestWithEmptyBodyHasNoBodyField() throws {
        let r = req(requestBody: "")
        let item = PostmanExporter.buildItem(r)
        let request = try #require(item["request"] as? [String: Any])
        #expect(request["body"] == nil)
    }

    // MARK: - JSON serialization

    @Test func exportProducesValidJson() throws {
        let requests = [
            req(url: "https://api.example.com/a", method: .get),
            req(url: "https://api.example.com/b", method: .post, requestBody: "{\"x\":1}"),
        ]
        let json = try #require(PostmanExporter.export(requests))
        let data = try #require(json.data(using: .utf8))
        let parsed = try JSONSerialization.jsonObject(with: data)
        #expect(parsed is [String: Any])
    }

    @Test func exportDefaultsToHakkaExportName() throws {
        let json = try #require(PostmanExporter.export([req()]))
        #expect(json.contains("Hakka Export"))
    }

    @Test func exportRespectsCustomName() throws {
        let json = try #require(PostmanExporter.export([req()], name: "My API"))
        #expect(json.contains("My API"))
    }
}

// MARK: - GraphQL Body Parser Tests

@Suite struct GraphQLBodyParserTests {

    // MARK: - Operation type detection

    @Test func detectsQueryType() throws {
        let body = #"{"query":"query GetUser { user { name } }","variables":{}}"#
        let info = try #require(GraphQLBodyParser.parse(body))
        #expect(info.operationType == "query")
    }

    @Test func detectsMutationType() throws {
        let body = #"{"query":"mutation CreateUser($name: String!) { createUser(name: $name) { id } }"}"#
        let info = try #require(GraphQLBodyParser.parse(body))
        #expect(info.operationType == "mutation")
    }

    @Test func detectsSubscriptionType() throws {
        let body = #"{"query":"subscription OnMessage { messageAdded { text } }"}"#
        let info = try #require(GraphQLBodyParser.parse(body))
        #expect(info.operationType == "subscription")
    }

    @Test func defaultsToQueryWhenNoTypeKeyword() throws {
        let body = #"{"operationName":"MyOp","query":"{ user { name } }"}"#
        let info = try #require(GraphQLBodyParser.parse(body))
        #expect(info.operationType == "query")
    }

    @Test func returnsNilForNilBody() {
        let info = GraphQLBodyParser.parse(nil)
        #expect(info == nil)
    }

    @Test func returnsNilForEmptyBody() {
        let info = GraphQLBodyParser.parse("")
        #expect(info == nil)
    }

    @Test func returnsNilForNonJsonBody() {
        let info = GraphQLBodyParser.parse("not json at all")
        #expect(info == nil)
    }

    // MARK: - Query text

    @Test func parsesQueryText() throws {
        let body = #"{"query":"query GetUser { user { name } }"}"#
        let info = try #require(GraphQLBodyParser.parse(body))
        #expect(info.query == "query GetUser { user { name } }")
    }

    @Test func queryNilWhenAbsent() throws {
        let body = #"{"operationName":"NoQuery"}"#
        let info = try #require(GraphQLBodyParser.parse(body))
        #expect(info.query == nil)
    }

    // MARK: - Variables

    @Test func parsesVariablesAsPrettyJson() throws {
        let body = #"{"query":"query Q { u }","variables":{"id":42,"name":"alice"}}"#
        let info = try #require(GraphQLBodyParser.parse(body))
        let varJson = try #require(info.variablesJSON)
        #expect(varJson.contains("id"))
        #expect(varJson.contains("name"))
    }

    @Test func variablesNilWhenAbsent() throws {
        let body = #"{"query":"query Q { u }"}"#
        let info = try #require(GraphQLBodyParser.parse(body))
        #expect(info.variablesJSON == nil)
    }

    @Test func variablesNilWhenEmpty() throws {
        let body = #"{"query":"query Q { u }","variables":{}}"#
        let info = try #require(GraphQLBodyParser.parse(body))
        #expect(info.variablesJSON == nil)
    }

    // MARK: - Error parsing

    @Test func parsesErrorsFromResponseBody() {
        let body = #"{"data":null,"errors":[{"message":"Not found","path":["user"]},{"message":"Auth failed"}]}"#
        let errors = GraphQLBodyParser.parseErrors(body)
        #expect(errors.count == 2)
        #expect(errors[0].message == "Not found")
        #expect(errors[0].path == "user")
        #expect(errors[1].message == "Auth failed")
        #expect(errors[1].path == nil)
    }

    @Test func errorsEmptyWhenNoErrorsKey() {
        let body = #"{"data":{"user":{"name":"alice"}}}"#
        let errors = GraphQLBodyParser.parseErrors(body)
        #expect(errors.isEmpty)
    }

    @Test func errorsEmptyForNilBody() {
        #expect(GraphQLBodyParser.parseErrors(nil).isEmpty)
    }

    @Test func errorsEmptyForEmptyBody() {
        #expect(GraphQLBodyParser.parseErrors("").isEmpty)
    }

    @Test func errorsEmptyForNonJsonBody() {
        #expect(GraphQLBodyParser.parseErrors("bad json").isEmpty)
    }

    @Test func errorWithMultiSegmentPath() {
        let body = #"{"errors":[{"message":"err","path":["users",0,"email"]}]}"#
        let errors = GraphQLBodyParser.parseErrors(body)
        #expect(errors.count == 1)
        #expect(errors[0].path == "users.0.email")
    }

    @Test func skipsErrorsWithoutMessageField() {
        let body = #"{"errors":[{"extensions":{"code":"NOT_FOUND"}},{"message":"Valid error"}]}"#
        let errors = GraphQLBodyParser.parseErrors(body)
        #expect(errors.count == 1)
        #expect(errors[0].message == "Valid error")
    }
}
