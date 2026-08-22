import Foundation
import Testing
@testable import HakkaCore

@Suite("GrpcURL")
struct GrpcURLIsGrpcURLTests {
    @Test func recognizesGrpcAndGrpcs() {
        #expect(GrpcURL.isGrpcURL("grpc://localhost:50051/pkg.Svc/Method") == true)
        #expect(GrpcURL.isGrpcURL("grpcs://api.example.com/pkg.Svc/Method") == true)
        #expect(GrpcURL.isGrpcURL("  GRPCS://api.example.com  ") == true)
    }

    @Test func rejectsHttpAndTemplateURLs() {
        #expect(GrpcURL.isGrpcURL("https://api.example.com") == false)
        #expect(GrpcURL.isGrpcURL("") == false)
        #expect(GrpcURL.isGrpcURL("{{baseUrl}}/socket") == false)
    }
}

@Suite("GrpcTarget")
struct GrpcTargetTests {
    @Test func parsesHostPortServiceAndMethod() throws {
        let url = try #require(URL(string: "grpc://localhost:50051/myapp.UserService/GetUser"))
        let target = try #require(GrpcTarget(url: url))

        #expect(target.host == "localhost")
        #expect(target.port == 50051)
        #expect(target.useTLS == false)
        #expect(target.service == "myapp.UserService")
        #expect(target.method == "GetUser")
    }

    @Test func grpcsImpliesTLSAndDefaultsPort443() throws {
        let url = try #require(URL(string: "grpcs://api.example.com/myapp.UserService/GetUser"))
        let target = try #require(GrpcTarget(url: url))

        #expect(target.useTLS == true)
        #expect(target.port == 443)
    }

    @Test func plaintextDefaultsPort50051() throws {
        let url = try #require(URL(string: "grpc://localhost/myapp.UserService/GetUser"))
        let target = try #require(GrpcTarget(url: url))
        #expect(target.port == 50051)
    }

    @Test func explicitPortOverridesDefault() throws {
        let url = try #require(URL(string: "grpc://localhost:9000/myapp.UserService/GetUser"))
        let target = try #require(GrpcTarget(url: url))
        #expect(target.port == 9000)
    }

    @Test func nonGrpcSchemeIsRejected() throws {
        let url = try #require(URL(string: "https://localhost:50051/myapp.UserService/GetUser"))
        #expect(GrpcTarget(url: url) == nil)
    }

    @Test func pathWithWrongSegmentCountIsRejected() throws {
        let missingMethod = try #require(URL(string: "grpc://localhost:50051/myapp.UserService"))
        #expect(GrpcTarget(url: missingMethod) == nil)

        let tooManySegments = try #require(URL(string: "grpc://localhost:50051/a/b/c"))
        #expect(GrpcTarget(url: tooManySegments) == nil)

        let noPath = try #require(URL(string: "grpc://localhost:50051"))
        #expect(GrpcTarget(url: noPath) == nil)
    }
}
