import Foundation
import Testing

@testable import HakkaDesktopCore

/// `$ref` is how essentially every real OpenAPI document expresses a request
/// body — Swagger codegen, FastAPI, NestJS and hand-written specs all put
/// schemas under `components` and reference them. The importer resolved none
/// of it, so a referenced body imported as the literal JSON string `""`:
/// valid, wrong, and silent. These tests are that regression fence.
@Suite("OpenAPI $ref resolution")
struct OpenAPIRefTests {
    private func spec(_ json: String) throws -> Collection {
        try OpenAPIImporter.parse(Data(json.utf8))
    }

    private func body(_ collection: Collection) -> String? {
        guard case let .request(request) = collection.nodes.first else { return nil }
        guard case let .raw(text, _) = request.body else { return nil }
        return text
    }

    @Test("a referenced request-body schema expands to the real example")
    func referencedRequestBody() throws {
        let collection = try spec(
            """
            {
              "openapi": "3.0.0",
              "info": {"title": "Refs"},
              "paths": {
                "/users": {
                  "post": {
                    "requestBody": {
                      "content": {
                        "application/json": {"schema": {"$ref": "#/components/schemas/User"}}
                      }
                    }
                  }
                }
              },
              "components": {
                "schemas": {
                  "User": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}, "age": {"type": "integer"}}
                  }
                }
              }
            }
            """)

        let text = try #require(body(collection))
        #expect(text != "\"\"")
        #expect(text.contains("name"))
        #expect(text.contains("age"))
    }

    @Test("a referenced parameter is imported rather than skipped")
    func referencedParameter() throws {
        let collection = try spec(
            """
            {
              "openapi": "3.0.0",
              "info": {"title": "Refs"},
              "paths": {
                "/users": {
                  "get": {"parameters": [{"$ref": "#/components/parameters/Page"}]}
                }
              },
              "components": {
                "parameters": {
                  "Page": {"name": "page", "in": "query", "required": true, "schema": {"type": "integer"}}
                }
              }
            }
            """)

        guard case let .request(request) = collection.nodes.first else {
            Issue.record("expected one request")
            return
        }
        #expect(request.query.map(\.name) == ["page"])
    }

    @Test("a self-referential schema terminates instead of recursing forever")
    func selfReferentialSchema() throws {
        let collection = try spec(
            """
            {
              "openapi": "3.0.0",
              "info": {"title": "Refs"},
              "paths": {
                "/nodes": {
                  "post": {
                    "requestBody": {
                      "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Node"}}}
                    }
                  }
                }
              },
              "components": {
                "schemas": {
                  "Node": {
                    "type": "object",
                    "properties": {"label": {"type": "string"}, "child": {"$ref": "#/components/schemas/Node"}}
                  }
                }
              }
            }
            """)

        let text = try #require(body(collection))
        #expect(text.contains("label"))
        #expect(text.contains("child"))
    }

    @Test("allOf branches merge into one example object")
    func allOfMerges() throws {
        let collection = try spec(
            """
            {
              "openapi": "3.0.0",
              "info": {"title": "Refs"},
              "paths": {
                "/users": {
                  "post": {
                    "requestBody": {
                      "content": {
                        "application/json": {
                          "schema": {"allOf": [{"$ref": "#/components/schemas/Base"}, {"$ref": "#/components/schemas/Extra"}]}
                        }
                      }
                    }
                  }
                }
              },
              "components": {
                "schemas": {
                  "Base": {"type": "object", "properties": {"id": {"type": "integer"}}},
                  "Extra": {"type": "object", "properties": {"email": {"type": "string"}}}
                }
              }
            }
            """)

        let text = try #require(body(collection))
        #expect(text.contains("id"))
        #expect(text.contains("email"))
    }

    @Test("an unresolvable ref degrades instead of throwing")
    func unresolvableRef() throws {
        let collection = try spec(
            """
            {
              "openapi": "3.0.0",
              "info": {"title": "Refs"},
              "paths": {
                "/users": {
                  "post": {
                    "requestBody": {
                      "content": {"application/json": {"schema": {"$ref": "common.json#/Missing"}}}
                    }
                  }
                }
              }
            }
            """)

        #expect(collection.nodes.count == 1)
    }

    @Test("JSON Pointer escapes are decoded")
    func pointerEscapes() {
        let resolver = OpenAPIRefResolver(root: [
            "paths": ["/users": ["marker": "hit"] as [String: Any]] as [String: Any],
        ])

        #expect(resolver.resolve(["$ref": "#/paths/~1users"]).string("marker") == "hit")
    }
}
