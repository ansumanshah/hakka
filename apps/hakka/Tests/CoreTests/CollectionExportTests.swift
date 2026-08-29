import Foundation
import Testing

@testable import HakkaCore

/// Round-trip coverage for `OpenAPIExporter`/`PostmanExporter`: build a
/// collection in memory, export it, re-import through the existing
/// `OpenAPIImporter`/`PostmanImporter`, and check the model survived —
/// the inverse of `InteropTests`' importer-only fixtures.
@Suite("OpenAPI collection export")
struct OpenAPICollectionExportTests {
    @Test("method, url, headers, query, and body round-trip through a tagged folder")
    func roundTripsThroughAFolder() throws {
        let getUser = RequestSpec(
            name: "Get user",
            method: .get,
            url: "https://api.example.com/users/{{id}}",
            headers: [HeaderPair(name: "X-Trace", value: "abc", enabled: true)],
            query: [
                HeaderPair(name: "expand", value: "profile", enabled: true),
                HeaderPair(name: "debug", value: "true", enabled: false),
            ],
        )
        let createUser = RequestSpec(
            name: "Create user",
            method: .post,
            url: "https://api.example.com/users",
            body: .raw(text: #"{"name":"Ada"}"#, contentType: "application/json"),
        )
        let collection = Collection(name: "Example API", nodes: [.folder(Folder(name: "Users", children: [.request(getUser), .request(createUser)]))])

        let reimported = try OpenAPIImporter.parse(OpenAPIExporter.export(collection))

        guard case let .folder(folder) = reimported.nodes.first else {
            Issue.record("expected a Users folder")
            return
        }
        #expect(folder.name == "Users")
        let requests: [RequestSpec] = folder.children.compactMap {
            if case let .request(r) = $0 { return r }
            return nil
        }

        let get = try #require(requests.first { $0.method == .get })
        #expect(get.url == "https://api.example.com/users/{{id}}")
        #expect(get.headers.first { $0.name == "X-Trace" }?.value == "abc")
        let expand = try #require(get.query.first { $0.name == "expand" })
        #expect(expand.value == "profile")
        #expect(expand.enabled == true)
        #expect(get.query.first { $0.name == "debug" }?.enabled == false)
        #expect(get.auth == .inherit) // OpenAPI carries no auth either direction

        let post = try #require(requests.first { $0.method == .post })
        #expect(post.url == "https://api.example.com/users")
        guard case let .raw(text, contentType) = post.body else {
            Issue.record("expected a raw JSON body")
            return
        }
        #expect(contentType == "application/json")
        #expect(text == #"{"name":"Ada"}"#)
    }

    @Test("an untagged root request stays untagged")
    func untaggedRequestStaysAtRoot() throws {
        let health = RequestSpec(name: "Health", method: .get, url: "https://api.example.com/health")
        let collection = Collection(name: "API", nodes: [.request(health)])

        let reimported = try OpenAPIImporter.parse(OpenAPIExporter.export(collection))

        guard case let .request(spec) = reimported.nodes.first else {
            Issue.record("expected a request node, not a folder")
            return
        }
        #expect(spec.url == "https://api.example.com/health")
        #expect(spec.method == .get)
    }
}

@Suite("Postman collection export")
struct PostmanCollectionExportTests {
    @Test("headers (enabled and disabled) and query round-trip")
    func headersAndQueryRoundTrip() throws {
        let spec = RequestSpec(
            name: "List orders",
            method: .get,
            url: "https://api.example.com/orders",
            headers: [
                HeaderPair(name: "X-Client", value: "hakka", enabled: true),
                HeaderPair(name: "X-Legacy", value: "unused", enabled: false),
            ],
            query: [HeaderPair(name: "status", value: "open", enabled: true)],
        )
        let collection = Collection(name: "Orders API", nodes: [.request(spec)])

        let reimported = try PostmanImporter.parse(PostmanExporter.export(collection))

        guard case let .request(result) = reimported.nodes.first else {
            Issue.record("expected a request node")
            return
        }
        #expect(result.method == .get)
        #expect(result.url == "https://api.example.com/orders")
        #expect(result.headers.contains { $0.name == "X-Client" && $0.value == "hakka" && $0.enabled == true })
        #expect(result.headers.contains { $0.name == "X-Legacy" && $0.value == "unused" && $0.enabled == false })
        #expect(result.query.first { $0.name == "status" }?.value == "open")
    }

    @Test("bearer, basic, and apiKey auth round-trip")
    func authRoundTrips() throws {
        let bearer = RequestSpec(name: "Bearer", method: .get, url: "https://api.example.com/a", auth: .bearer(token: "tok123"))
        let basic = RequestSpec(name: "Basic", method: .get, url: "https://api.example.com/b", auth: .basic(username: "ann", password: "secret"))
        let apiKey = RequestSpec(
            name: "API key",
            method: .get,
            url: "https://api.example.com/c",
            auth: .apiKey(name: "X-Api-Key", value: "k-1", placement: .query),
        )
        let none = RequestSpec(name: "No auth", method: .get, url: "https://api.example.com/d", auth: .none)
        let inherited = RequestSpec(name: "Inherited", method: .get, url: "https://api.example.com/e")
        let collection = Collection(
            name: "Auth API",
            nodes: [.request(bearer), .request(basic), .request(apiKey), .request(none), .request(inherited)],
        )

        let reimported = try PostmanImporter.parse(PostmanExporter.export(collection))
        let byName = Dictionary(uniqueKeysWithValues: reimported.nodes.compactMap { node -> (String, RequestSpec)? in
            guard case let .request(spec) = node else { return nil }
            return (spec.name, spec)
        })

        #expect(byName["Bearer"]?.auth == .bearer(token: "tok123"))
        #expect(byName["Basic"]?.auth == .basic(username: "ann", password: "secret"))
        #expect(byName["API key"]?.auth == .apiKey(name: "X-Api-Key", value: "k-1", placement: .query))
        // `.none` alone here resolves to `Optional.none` (nil), not
        // `AuthSpec.none` — the classic collision between an `Optional` case
        // and a wrapped type's own case of the same name.
        #expect(byName["No auth"]?.auth == AuthSpec.none)
        #expect(byName["Inherited"]?.auth == .inherit)
    }

    @Test("a static-token oauth2 grant round-trips as a literal accessToken")
    func oauth2StaticTokenRoundTrips() throws {
        let spec = RequestSpec(name: "Me", method: .get, url: "https://api.example.com/me", auth: .oauth2(accessToken: "tok456"))
        let collection = Collection(name: "OAuth API", nodes: [.request(spec)])

        let reimported = try PostmanImporter.parse(PostmanExporter.export(collection))

        guard case let .request(result) = reimported.nodes.first,
              case let .oauth2(config) = result.auth,
              case let .staticToken(accessToken) = config.grant else {
            Issue.record("expected an oauth2 request with a static token")
            return
        }
        #expect(accessToken == "tok456")
    }

    @Test("form, multipart, graphql, and file bodies round-trip")
    func bodyModesRoundTrip() throws {
        let form = RequestSpec(
            name: "Form",
            method: .post,
            url: "https://api.example.com/form",
            body: .form([HeaderPair(name: "q", value: "hello world")]),
        )
        let multipart = RequestSpec(
            name: "Multipart",
            method: .post,
            url: "https://api.example.com/upload",
            body: .multipart([MultipartPart(name: "avatar", value: "x", contentType: "image/png")]),
        )
        let graphql = RequestSpec(
            name: "GraphQL",
            method: .post,
            url: "https://api.example.com/graphql",
            body: .graphql(query: "query { me { id } }", variables: "{}", operationName: "Me"),
        )
        let file = RequestSpec(
            name: "File",
            method: .post,
            url: "https://api.example.com/blob",
            body: .file(path: "/tmp/upload.bin", contentType: "application/octet-stream"),
        )
        let collection = Collection(name: "Bodies API", nodes: [.request(form), .request(multipart), .request(graphql), .request(file)])

        let reimported = try PostmanImporter.parse(PostmanExporter.export(collection))
        let byName = Dictionary(uniqueKeysWithValues: reimported.nodes.compactMap { node -> (String, RequestSpec)? in
            guard case let .request(spec) = node else { return nil }
            return (spec.name, spec)
        })

        guard case let .form(pairs) = byName["Form"]?.body else {
            Issue.record("expected a form body")
            return
        }
        #expect(pairs.count == 1)
        #expect(pairs.first?.name == "q")
        #expect(pairs.first?.value == "hello world")

        guard case let .multipart(parts) = byName["Multipart"]?.body else {
            Issue.record("expected a multipart body")
            return
        }
        #expect(parts.first?.name == "avatar")
        #expect(parts.first?.value == "x")
        #expect(parts.first?.contentType == "image/png")

        guard case let .graphql(query, variables, operationName) = byName["GraphQL"]?.body else {
            Issue.record("expected a graphql body")
            return
        }
        #expect(query == "query { me { id } }")
        #expect(variables == "{}")
        #expect(operationName == "Me")

        guard case let .file(path, _) = byName["File"]?.body else {
            Issue.record("expected a file body")
            return
        }
        #expect(path == "/tmp/upload.bin")
    }

    @Test("a raw body's exact content type round-trips via its explicit header")
    func rawBodyContentTypeRoundTrips() throws {
        let spec = RequestSpec(
            name: "Vendor JSON",
            method: .post,
            url: "https://api.example.com/vendor",
            headers: [HeaderPair(name: "Content-Type", value: "application/vnd.api+json", enabled: true)],
            body: .raw(text: #"{"a":1}"#, contentType: "application/vnd.api+json"),
        )
        let collection = Collection(name: "Vendor API", nodes: [.request(spec)])

        let reimported = try PostmanImporter.parse(PostmanExporter.export(collection))

        guard case let .request(result) = reimported.nodes.first, case let .raw(text, contentType) = result.body else {
            Issue.record("expected a raw body")
            return
        }
        #expect(contentType == "application/vnd.api+json")
        #expect(text == #"{"a":1}"#)
    }

    @Test("collection-level basic auth round-trips")
    func collectionAuthRoundTrips() throws {
        let collection = Collection(name: "Root Auth API", nodes: [], auth: .basic(username: "root", password: "toor"))

        let reimported = try PostmanImporter.parse(PostmanExporter.export(collection))

        #expect(reimported.auth == .basic(username: "root", password: "toor"))
    }

    @Test("nested folders round-trip")
    func nestedFoldersRoundTrip() throws {
        let ping = RequestSpec(name: "Ping", method: .get, url: "https://api.example.com/v1/ping")
        let inner = Folder(name: "v1", children: [.request(ping)])
        let collection = Collection(name: "Nested API", nodes: [.folder(Folder(name: "Root", children: [.folder(inner)]))])

        let reimported = try PostmanImporter.parse(PostmanExporter.export(collection))

        guard case let .folder(outer) = reimported.nodes.first,
              case let .folder(v1) = outer.children.first,
              case let .request(spec) = v1.children.first else {
            Issue.record("expected Root/v1/Ping")
            return
        }
        #expect(outer.name == "Root")
        #expect(v1.name == "v1")
        #expect(spec.url == "https://api.example.com/v1/ping")
    }
}
