import Foundation
import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

private struct StubTransport: RequestTransport {
    let handler: @Sendable (URLRequest, Bool) async throws -> TransportResponse

    func execute(_ request: URLRequest, followRedirects: Bool) async throws -> TransportResponse {
        try await handler(request, followRedirects)
    }
}

private func jsonResponse(_ body: String, status: Int = 200) -> TransportResponse {
    let response = HTTPURLResponse(
        url: URL(string: "https://api.example.com")!,
        statusCode: status,
        httpVersion: "HTTP/1.1",
        headerFields: [:],
    )!
    return TransportResponse(data: Data(body.utf8), response: response)
}

/// Coverage for `FolderRunModel`, the app-side state `AppModel.runFolder`
/// drives — a `RequestTransport` stub is injected through its `init` so
/// these never touch the network, mirroring `HakkaCoreTests`' `FolderRunner`
/// coverage but from the `@Observable` model's side: does `isRunning` flip
/// correctly, does the summary land, and does a captured value make it back
/// out through the returned scope the way `AppModel.runFolder` needs it to.
@Suite("FolderRunModel")
@MainActor
struct FolderRunModelTests {
    private func collection() -> Collection { Collection(name: "C") }

    @Test func runPopulatesSummaryAndClearsRunningState() async throws {
        let model = FolderRunModel(transport: StubTransport { _, _ in jsonResponse("{}") })
        let folder = Folder(name: "F", children: [.request(RequestSpec(name: "R", url: "https://api.example.com/x"))])

        #expect(model.isRunning == false)
        await model.run(folder, folderChain: [], collection: collection(), scope: VariableScope())

        #expect(model.isRunning == false)
        #expect(model.lastRunWasEmpty == false)
        let summary = try #require(model.summary)
        #expect(summary.items.count == 1)
        #expect(summary.passedCount == 1)
    }

    /// An empty folder must clear any previous summary and flag the run as
    /// empty, not silently keep showing the last real run's results.
    @Test func emptyFolderClearsSummaryAndSetsFlag() async throws {
        let model = FolderRunModel(transport: StubTransport { _, _ in jsonResponse("{}") })
        let populated = Folder(name: "F", children: [.request(RequestSpec(name: "R", url: "https://api.example.com/x"))])
        await model.run(populated, folderChain: [], collection: collection(), scope: VariableScope())
        #expect(model.summary != nil)

        let empty = Folder(name: "Empty")
        await model.run(empty, folderChain: [], collection: collection(), scope: VariableScope())

        #expect(model.summary == nil)
        #expect(model.lastRunWasEmpty == true)
    }

    /// The scope `run` returns is what `AppModel.runFolder` folds into
    /// `EnvironmentModel.adoptRuntime` — a captured value must survive the
    /// app-model round trip, not just the core `FolderRunner` call.
    @Test func runReturnsFinalScopeWithCapturedValue() async throws {
        let model = FolderRunModel(transport: StubTransport { _, _ in jsonResponse(#"{"token":"abc"}"#) })
        let login = RequestSpec(
            name: "Login",
            url: "https://api.example.com/login",
            captures: [ResponseCapture(variable: "authToken", source: .jsonPath("token"))],
        )
        let folder = Folder(name: "F", children: [.request(login)])

        let finalScope = await model.run(folder, folderChain: [], collection: collection(), scope: VariableScope())

        #expect(finalScope?.value(for: "authToken") == "abc")
    }
}
