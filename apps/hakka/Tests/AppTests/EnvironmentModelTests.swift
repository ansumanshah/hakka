@testable import HakkaApp
import HakkaCore
import Testing

@Suite("Environment editor scope")
@MainActor
struct EnvironmentModelTests {
    @Test func duplicateAndIncompleteRowsRemainSafeToUse() throws {
        let model = EnvironmentModel()
        model.addEnvironment(named: "QA")
        var environment = try #require(model.selected)
        environment.variables = [
            EnvironmentVariable(name: "baseUrl", value: "disabled", enabled: false),
            EnvironmentVariable(name: "baseUrl", value: "http://127.0.0.1:51440"),
            EnvironmentVariable(name: "baseUrl", value: "http://127.0.0.1:1"),
            EnvironmentVariable(name: "", value: "unfinished"),
            EnvironmentVariable(name: "", value: "another unfinished row"),
        ]
        model.update(environment)

        let scope = model.scope
        #expect(scope.environment["baseUrl"] == environment.value(for: "baseUrl"))
        #expect(scope.environment.count == 1)
        #expect(scope.environment[""] == nil)
    }
}
