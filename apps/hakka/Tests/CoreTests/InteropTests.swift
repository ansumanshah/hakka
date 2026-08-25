import Foundation
import Testing
@testable import HakkaCore
import HakkaCommon

// MARK: - Fixtures

/// The scenario the code generators are contractually exact for: headers,
/// a query param, a JSON body, and bearer auth.
private let fixtureSpec = RequestSpec(
    name: "Create user",
    method: .post,
    url: "https://api.example.com/users",
    headers: [HeaderPair(name: "Content-Type", value: "application/json")],
    query: [HeaderPair(name: "active", value: "true")],
    body: .raw(text: #"{"name":"Ada"}"#, contentType: "application/json"),
    auth: .bearer(token: "abc123"),
)

@Suite("Code generators — exact output")
struct CodeGeneratorExactTests {
    @Test func curlRaw() {
        let expected = """
        curl -X POST 'https://api.example.com/users?active=true' \\
          -H 'Content-Type: application/json' \\
          -H 'Authorization: Bearer abc123' \\
          -d '{"name":"Ada"}'
        """
        #expect(CodeGenerator.generate(fixtureSpec, language: .curl, secrets: .raw) == expected)
    }

    @Test func javascriptRaw() {
        let expected = """
        fetch('https://api.example.com/users?active=true', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer abc123'
          },
          body: '{"name":"Ada"}'
        })
        """
        #expect(CodeGenerator.generate(fixtureSpec, language: .javascript, secrets: .raw) == expected)
    }

    @Test func swiftRaw() {
        let expected = """
        var request = URLRequest(url: URL(string: "https://api.example.com/users?active=true")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer abc123", forHTTPHeaderField: "Authorization")
        request.httpBody = Data("{\\"name\\":\\"Ada\\"}".utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        """
        #expect(CodeGenerator.generate(fixtureSpec, language: .swift, secrets: .raw) == expected)
    }

    @Test func pythonRaw() {
        let expected = """
        import requests

        url = "https://api.example.com/users?active=true"
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer abc123",
        }
        data = "{\\"name\\":\\"Ada\\"}"

        response = requests.request("POST", url, headers=headers, data=data)
        """
        #expect(CodeGenerator.generate(fixtureSpec, language: .python, secrets: .raw) == expected)
    }

    @Test func goRaw() {
        let expected = """
        package main

        import (
        \t"fmt"
        \t"io"
        \t"net/http"
        \t"strings"
        )

        func main() {
        \tbody := strings.NewReader("{\\"name\\":\\"Ada\\"}")
        \treq, err := http.NewRequest("POST", "https://api.example.com/users?active=true", body)
        \tif err != nil {
        \t\tpanic(err)
        \t}
        \treq.Header.Set("Content-Type", "application/json")
        \treq.Header.Set("Authorization", "Bearer abc123")

        \tresp, err := http.DefaultClient.Do(req)
        \tif err != nil {
        \t\tpanic(err)
        \t}
        \tdefer resp.Body.Close()

        \trespBody, _ := io.ReadAll(resp.Body)
        \tfmt.Println(string(respBody))
        }
        """
        #expect(CodeGenerator.generate(fixtureSpec, language: .go, secrets: .raw) == expected)
    }

    @Test func httpieRaw() {
        let expected = """
        http POST 'https://api.example.com/users?active=true' \\
          'Content-Type:application/json' \\
          'Authorization:Bearer abc123' \\
          <<< '{"name":"Ada"}'
        """
        #expect(CodeGenerator.generate(fixtureSpec, language: .httpie, secrets: .raw) == expected)
    }
}

@Suite("Code generators — redaction")
struct CodeGeneratorRedactionTests {
    @Test func curlRedactsBearerToken() {
        let code = CodeGenerator.generate(fixtureSpec, language: .curl, secrets: .redacted)
        #expect(code.contains("Authorization: Bearer REDACTED"))
        #expect(!code.contains("abc123"))
        #expect(code.contains("Content-Type: application/json")) // non-credential headers stay untouched
    }

    @Test func javascriptRedactsBearerToken() {
        let code = CodeGenerator.generate(fixtureSpec, language: .javascript, secrets: .redacted)
        #expect(code.contains("'Authorization': 'Bearer REDACTED'"))
        #expect(!code.contains("abc123"))
    }

    @Test func redactsApiKeyInQuery() {
        let spec = RequestSpec(
            name: "List",
            method: .get,
            url: "https://api.example.com/items",
            auth: .apiKey(name: "token", value: "supersecret", placement: .query),
        )
        let redacted = CodeGenerator.generate(spec, language: .curl, secrets: .redacted)
        #expect(redacted.contains("token=REDACTED"))
        #expect(!redacted.contains("supersecret"))

        let raw = CodeGenerator.generate(spec, language: .curl, secrets: .raw)
        #expect(raw.contains("token=supersecret"))
    }

    @Test func redactsAuthorizationHeaderTypedDirectly() {
        let spec = RequestSpec(
            name: "Manual header",
            method: .get,
            url: "https://api.example.com/",
            headers: [HeaderPair(name: "Authorization", value: "Bearer typed-in-manually")],
        )
        let code = CodeGenerator.generate(spec, language: .curl, secrets: .redacted)
        #expect(code.contains("Authorization: Bearer REDACTED")) // scheme prefix kept, credential dropped
        #expect(!code.contains("typed-in-manually"))
    }

    @Test func redactsCookieHeaderWithNoRecognizedScheme() {
        let spec = RequestSpec(
            name: "Manual cookie",
            method: .get,
            url: "https://api.example.com/",
            headers: [HeaderPair(name: "Cookie", value: "session=super-secret-value")],
        )
        let code = CodeGenerator.generate(spec, language: .curl, secrets: .redacted)
        #expect(code.contains("Cookie: REDACTED")) // no known auth scheme prefix to preserve
        #expect(!code.contains("super-secret-value"))
    }
}

@Suite("Code generators — body variants")
struct CodeGeneratorBodyVariantTests {
    @Test func multipartOmitsManualContentTypeHeader() {
        let spec = RequestSpec(
            name: "Upload",
            method: .post,
            url: "https://api.example.com/upload",
            body: .multipart([MultipartPart(name: "file", filePath: "/tmp/photo.png", contentType: "image/png")]),
        )
        let code = CodeGenerator.generate(spec, language: .curl, secrets: .raw)
        #expect(code.contains("-F 'file=@/tmp/photo.png;type=image/png'"))
        #expect(!code.contains("Content-Type: multipart/form-data")) // curl -F sets its own boundary
    }

    @Test func formEncodedBody() {
        let spec = RequestSpec(
            name: "Login",
            method: .post,
            url: "https://api.example.com/login",
            body: .form([HeaderPair(name: "user", value: "ada"), HeaderPair(name: "pass", value: "s3cr3t")]),
        )
        let code = CodeGenerator.generate(spec, language: .python, secrets: .raw)
        #expect(code.contains(#""user": "ada","#))
        #expect(code.contains(#""pass": "s3cr3t","#))
    }

    /// A form field value containing `&`/`=` must not corrupt the generated
    /// JS. `new URLSearchParams('name=value&...')` (the string constructor)
    /// re-parses its argument as a query string, so an unescaped `&` in a
    /// value silently injects/reinterprets fields — the object-literal form
    /// (`new URLSearchParams({ name: 'value' })`) takes each entry literally
    /// instead and can't be reinterpreted that way.
    @Test func javascriptFormEncodedBodyDoesNotMisparseAmpersandsInValues() {
        let spec = RequestSpec(
            name: "Login",
            method: .post,
            url: "https://api.example.com/login",
            body: .form([
                HeaderPair(name: "user", value: "ada"),
                HeaderPair(name: "redirect", value: "https://evil.test?x=1&y=2"),
            ]),
        )
        let code = CodeGenerator.generate(spec, language: .javascript, secrets: .raw)
        #expect(code.contains("new URLSearchParams({"))
        #expect(!code.contains("new URLSearchParams('"))
        #expect(code.contains("'redirect': 'https://evil.test?x=1&y=2'"))
    }
}

// MARK: - cURL importer

@Suite("cURL importer")
struct CurlImporterTests {
    @Test func parsesHeadersAndJSONBody() throws {
        let command = """
        curl -X POST 'https://api.example.com/users?active=true' \\
          -H 'Content-Type: application/json' \\
          -H 'Authorization: Bearer abc123' \\
          -d '{"name":"Ada"}'
        """
        let spec = try CurlImporter.parse(command)
        #expect(spec.method == .post)
        #expect(spec.url == "https://api.example.com/users")
        #expect(spec.query.first { $0.name == "active" }?.value == "true")
        #expect(spec.headers.first { $0.name == "Content-Type" }?.value == "application/json")
        // -H is a literal header, not parsed into AuthSpec — only -u maps to auth.
        #expect(spec.headers.first { $0.name == "Authorization" }?.value == "Bearer abc123")
        #expect(spec.auth == .none)
        if case let .raw(text, contentType) = spec.body {
            #expect(text == #"{"name":"Ada"}"#)
            #expect(contentType == "application/json")
        } else {
            Issue.record("expected a raw body")
        }
    }

    @Test func parsesBasicAuthAndForm() throws {
        let command = #"curl -u ada:s3cr3t --form "field=value" --form "file=@/tmp/a.png;type=image/png" https://api.example.com/upload"#
        let spec = try CurlImporter.parse(command)
        #expect(spec.url == "https://api.example.com/upload")
        if case let .basic(username, password) = spec.auth {
            #expect(username == "ada")
            #expect(password == "s3cr3t")
        } else {
            Issue.record("expected basic auth")
        }
        if case let .multipart(parts) = spec.body {
            #expect(parts.count == 2)
            #expect(parts[0].name == "field" && parts[0].value == "value")
            #expect(parts[1].name == "file" && parts[1].filePath == "/tmp/a.png" && parts[1].contentType == "image/png")
        } else {
            Issue.record("expected a multipart body")
        }
    }

    @Test func joinsLineContinuationsAndDefaultsToGet() throws {
        let command = "curl \\\n  'https://api.example.com/ping'"
        let spec = try CurlImporter.parse(command)
        #expect(spec.method == .get)
        #expect(spec.url == "https://api.example.com/ping")
    }

    @Test func missingURLThrows() {
        #expect(throws: ImportError.self) {
            try CurlImporter.parse("curl -X GET")
        }
    }
}

// MARK: - HAR importer (round-trips Hakka's own HarExporter)

@Suite("HAR importer")
struct HarImporterTests {
    private static let fixture = #"""
    {
      "log": {
        "version": "1.2",
        "creator": { "name": "Hakka", "version": "0.1.0" },
        "entries": [
          {
            "startedDateTime": "2026-08-20T10:00:00.000Z",
            "time": 42,
            "request": {
              "method": "POST",
              "url": "https://api.example.com/users?active=true",
              "httpVersion": "HTTP/1.1",
              "headers": [
                { "name": "Content-Type", "value": "application/json" },
                { "name": "Authorization", "value": "Bearer abc123" }
              ],
              "queryString": [ { "name": "active", "value": "true" } ],
              "headersSize": -1,
              "bodySize": 15,
              "postData": { "mimeType": "application/json", "text": "{\"name\":\"Ada\"}" }
            },
            "response": {
              "status": 201,
              "statusText": "",
              "httpVersion": "HTTP/1.1",
              "headers": [],
              "content": { "size": 0, "mimeType": "", "text": "" },
              "redirectURL": "",
              "headersSize": -1,
              "bodySize": 0
            },
            "cache": {},
            "timings": { "dns": -1, "connect": -1, "ssl": -1, "send": 0, "wait": 42, "receive": -1 }
          }
        ]
      }
    }
    """#

    @Test func importsEntryFaithfully() throws {
        let specs = try HarImporter.parse(Data(Self.fixture.utf8))
        #expect(specs.count == 1)
        let spec = specs[0]
        #expect(spec.method == .post)
        #expect(spec.url == "https://api.example.com/users")
        #expect(spec.query.first { $0.name == "active" }?.value == "true")
        #expect(spec.headers.first { $0.name == "Authorization" }?.value == "Bearer abc123")
        if case let .raw(text, contentType) = spec.body {
            #expect(text == #"{"name":"Ada"}"#)
            #expect(contentType == "application/json")
        } else {
            Issue.record("expected a raw body")
        }
    }

    @Test func roundTripsThroughHarExporter() throws {
        let original = NetworkRequest(
            url: "https://api.example.com/users?active=true",
            method: .post,
            status: 201,
            startTime: 1_755_000_000_000,
            requestHeaders: ["Content-Type": ["application/json"]],
            requestBody: #"{"name":"Ada"}"#,
        )
        guard let harJSON = HarExporter.export([original]) else {
            Issue.record("HarExporter.export returned nil")
            return
        }
        let specs = try HarImporter.parse(Data(harJSON.utf8))
        #expect(specs.count == 1)
        #expect(specs[0].url == "https://api.example.com/users")
        #expect(specs[0].method == .post)
        if case let .raw(text, _) = specs[0].body {
            #expect(text == #"{"name":"Ada"}"#)
        } else {
            Issue.record("expected a raw body")
        }
    }

    @Test func missingLogThrows() {
        #expect(throws: ImportError.self) {
            try HarImporter.parse(Data("{}".utf8))
        }
    }
}

// MARK: - Postman importer

@Suite("Postman importer")
struct PostmanImporterTests {
    private static let fixture = #"""
    {
      "info": { "name": "Example API", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      "item": [
        {
          "name": "Users",
          "item": [
            {
              "name": "Create user",
              "request": {
                "method": "POST",
                "header": [ { "key": "Content-Type", "value": "application/json" } ],
                "url": { "raw": "https://api.example.com/users?active=true", "query": [ { "key": "active", "value": "true" } ] },
                "auth": { "type": "bearer", "bearer": [ { "key": "token", "value": "abc123", "type": "string" } ] },
                "body": { "mode": "raw", "raw": "{\"name\":\"Ada\"}", "options": { "raw": { "language": "json" } } }
              }
            },
            {
              "name": "List users",
              "request": {
                "method": "GET",
                "header": [],
                "url": { "raw": "https://api.example.com/users" }
              }
            }
          ]
        }
      ]
    }
    """#

    @Test func parsesFolderNestingAndBearerAuth() throws {
        let collection = try PostmanImporter.parse(Data(Self.fixture.utf8))
        #expect(collection.name == "Example API")
        #expect(collection.nodes.count == 1)
        guard case let .folder(folder) = collection.nodes[0] else {
            Issue.record("expected root to be a folder")
            return
        }
        #expect(folder.name == "Users")
        #expect(folder.children.count == 2)

        guard case let .request(createUser) = folder.children[0] else {
            Issue.record("expected a request node")
            return
        }
        #expect(createUser.method == .post)
        #expect(createUser.url == "https://api.example.com/users")
        #expect(createUser.query.first { $0.name == "active" }?.value == "true")
        if case .bearer(let token) = createUser.auth {
            #expect(token == "abc123")
        } else {
            Issue.record("expected bearer auth")
        }
        if case let .raw(text, contentType) = createUser.body {
            #expect(text == #"{"name":"Ada"}"#)
            #expect(contentType == "application/json")
        } else {
            Issue.record("expected a raw JSON body")
        }
    }

    @Test func requestWithoutExplicitAuthInherits() throws {
        let collection = try PostmanImporter.parse(Data(Self.fixture.utf8))
        guard case let .folder(folder) = collection.nodes[0],
              case let .request(listUsers) = folder.children[1] else {
            Issue.record("expected the second child to be a request")
            return
        }
        #expect(listUsers.auth == .inherit)
    }

    @Test func emptyInputThrows() {
        #expect(throws: ImportError.self) {
            try PostmanImporter.parse(Data())
        }
    }

    /// Postman Collection v2.x schemas allow `item.request` to be a bare URL
    /// string rather than the full request object. Before this was handled
    /// explicitly, the object-only guard discarded it, importing `url: ""`.
    @Test func requestAsAPlainURLStringImportsWithThatURL() throws {
        let fixture = #"""
        {
          "info": { "name": "String Request API" },
          "item": [
            { "name": "Get root", "request": "https://api.example.com/root?active=true" }
          ]
        }
        """#
        let collection = try PostmanImporter.parse(Data(fixture.utf8))
        guard case let .request(spec) = collection.nodes.first else {
            Issue.record("expected a request node")
            return
        }
        #expect(spec.method == .get)
        #expect(spec.url == "https://api.example.com/root")
        #expect(spec.query.first { $0.name == "active" }?.value == "true")
    }
}

// MARK: - OpenAPI importer

@Suite("OpenAPI importer")
struct OpenAPIImporterTests {
    private static let fixture = #"""
    {
      "openapi": "3.0.0",
      "info": { "title": "Example API" },
      "servers": [ { "url": "https://api.example.com" } ],
      "paths": {
        "/users/{id}": {
          "get": {
            "summary": "Get user",
            "tags": ["Users"],
            "parameters": [
              { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } },
              { "name": "expand", "in": "query", "required": false, "example": "profile" }
            ]
          }
        },
        "/users": {
          "post": {
            "summary": "Create user",
            "tags": ["Users"],
            "requestBody": {
              "content": {
                "application/json": { "example": { "name": "Ada" } }
              }
            }
          }
        }
      }
    }
    """#

    @Test func convertsPathParamsAndGroupsByTag() throws {
        let collection = try OpenAPIImporter.parse(Data(Self.fixture.utf8))
        #expect(collection.nodes.count == 1)
        guard case let .folder(folder) = collection.nodes[0] else {
            Issue.record("expected a Users folder")
            return
        }
        #expect(folder.name == "Users")
        #expect(folder.children.count == 2)

        let requests: [RequestSpec] = folder.children.compactMap {
            if case let .request(r) = $0 { return r }
            return nil
        }
        let getUser = try #require(requests.first { $0.method == .get })
        #expect(getUser.url == "https://api.example.com/users/{{id}}")
        #expect(getUser.query.first { $0.name == "expand" }?.value == "profile")
        #expect(getUser.query.first { $0.name == "expand" }?.enabled == false) // optional -> present but disabled

        let createUser = try #require(requests.first { $0.method == .post })
        #expect(createUser.url == "https://api.example.com/users")
        if case let .raw(text, contentType) = createUser.body {
            #expect(text.contains("\"name\""))
            #expect(text.contains("Ada"))
            #expect(contentType == "application/json")
        } else {
            Issue.record("expected a raw JSON body example")
        }
    }

    @Test func missingPathsThrows() {
        #expect(throws: ImportError.self) {
            try OpenAPIImporter.parse(Data(#"{"openapi":"3.0.0"}"#.utf8))
        }
    }
}
