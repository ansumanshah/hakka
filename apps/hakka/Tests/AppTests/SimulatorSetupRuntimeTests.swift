import Foundation
@testable import HakkaApp
import Testing

@MainActor
@Suite("Simulator setup runtime")
struct SimulatorSetupRuntimeTests {
    @Test func discoveryFiltersUnavailableAndNonIOSDevicesWithoutBooting() async throws {
        let id = UUID().uuidString
        let recorder = SimulatorCommandRecorder(output: Data("""
        {"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-26":[
          {"udid":"\(id)","name":"iPhone","state":"Shutdown","isAvailable":true},
          {"udid":"\(UUID().uuidString)","name":"Unavailable","state":"Shutdown","isAvailable":false},
          {"udid":"booted","name":"Invalid","state":"Booted","isAvailable":true}],
          "com.apple.CoreSimulator.SimRuntime.tvOS-26":[
          {"udid":"\(UUID().uuidString)","name":"Apple TV","state":"Shutdown","isAvailable":true}]}}
        """.utf8))
        let runtime = SimulatorSetupRuntime(run: { executable, arguments, timeout in
            await recorder.record(executable, arguments, timeout)
        })
        #expect(try await runtime.discoverTargets() == [SimulatorSetupTarget(id: id, name: "iPhone", state: "Shutdown")])
        #expect(await recorder.calls.map(\.arguments) == [["simctl", "list", "devices", "available", "--json"]])
    }

    @Test func allMutationsNameTheExactSelectedTargetAndPreserveCertificatePath() async throws {
        let recorder = SimulatorCommandRecorder()
        let runtime = SimulatorSetupRuntime(run: { executable, arguments, timeout in
            await recorder.record(executable, arguments, timeout)
        })
        let id = UUID().uuidString
        let path = "/tmp/Hakka's public $(echo literal) CA.pem"
        let url = try #require(URL(string: "https://example.com/?hakka_setup=test"))
        try await runtime.boot(targetID: id)
        try await runtime.installCertificate(targetID: id, path: path)
        try await runtime.openSafari(targetID: id, url: url)
        let calls = await recorder.calls
        #expect(calls.map(\.arguments) == [
            ["simctl", "boot", id], ["simctl", "bootstatus", id, "-b"],
            ["simctl", "keychain", id, "add-root-cert", path],
            ["simctl", "launch", id, "com.apple.mobilesafari"],
            ["simctl", "openurl", id, url.absoluteString],
        ])
        #expect(calls.allSatisfy { $0.executable == "/usr/bin/xcrun" && $0.timeout > 0 && $0.timeout <= 60 })
    }

    @Test func ambiguousTargetCannotReachMutationRunner() async {
        let recorder = SimulatorCommandRecorder()
        let runtime = SimulatorSetupRuntime(run: { executable, arguments, timeout in
            await recorder.record(executable, arguments, timeout)
        })
        do {
            try await runtime.installCertificate(targetID: "booted", path: "/tmp/public.pem")
            Issue.record("An ambiguous target was accepted")
        } catch {}
        #expect(await recorder.calls.isEmpty)
    }

    @Test func exclusiveReservationPersistsUntilReleased() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("hakka-reservation-test-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let runtime = SimulatorSetupRuntime()
        let id = UUID().uuidString
        let first = try runtime.reserve(targetID: id, directory: directory)
        #expect(throws: SimulatorSetupFailure.self) { try runtime.reserve(targetID: id, directory: directory) }
        let other = try runtime.reserve(targetID: UUID().uuidString, directory: directory)
        other.release()
        first.release()
        let next = try runtime.reserve(targetID: id, directory: directory)
        next.release()
    }

    @Test func malformedPublicCertificateDoesNotProduceAFingerprint() throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("hakka-invalid-ca-" + UUID().uuidString + ".pem")
        defer { try? FileManager.default.removeItem(at: path) }
        try "-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----".write(to: path, atomically: true, encoding: .utf8)
        let runtime = SimulatorSetupRuntime()
        #expect(throws: SimulatorSetupFailure.self) { try runtime.certificateFingerprint(path: path.path) }
    }

    @Test func realCommandDeadlineTerminatesBoundedChild() async {
        do {
            _ = try await SimulatorSetupRuntime.runCommand(executable: "/bin/sleep", arguments: ["5"], timeout: 0.05)
            Issue.record("A timed out child succeeded")
        } catch {
            #expect(error.localizedDescription.contains("timed out"))
        }
    }
}

private actor SimulatorCommandRecorder {
    struct Call: Sendable {
        let executable: String
        let arguments: [String]
        let timeout: TimeInterval
    }

    var calls: [Call] = []
    let output: Data
    init(output: Data = Data()) {
        self.output = output
    }

    func record(_ executable: String, _ arguments: [String], _ timeout: TimeInterval) -> Data {
        calls.append(Call(executable: executable, arguments: arguments, timeout: timeout))
        return output
    }
}
