import Foundation
@testable import HakkaApp
import Testing

@Suite("Device proxy setup")
struct ProxyDeviceSetupGuideTests {
    @Test func simulatorRequiresAnExplicitTargetAndPublicCertificate() {
        #expect(ProxyDeviceSetupGuide.simulatorCertificateCommand(simulatorID: "booted", certificatePath: "/tmp/ca.pem") == nil)
        #expect(ProxyDeviceSetupGuide.simulatorCertificateCommand(simulatorID: nil, certificatePath: "/tmp/ca.pem") == nil)
        #expect(ProxyDeviceSetupGuide.simulatorCertificateCommand(simulatorID: UUID().uuidString, certificatePath: nil) == nil)
        #expect(ProxyDeviceSetupGuide.simulatorCertificateCommand(simulatorID: UUID().uuidString, certificatePath: "") == nil)
    }

    @Test func certificateCommandPreservesTheTargetAndPathWithoutShellExpansion() throws {
        let id = UUID().uuidString
        let path = "/tmp/Hakka's public $(echo expanded) CA.pem"
        let command = try #require(ProxyDeviceSetupGuide.simulatorCertificateCommand(simulatorID: id, certificatePath: path))
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", "xcrun() { printf '%s\\n' \"$@\"; }; " + command]
        let output = Pipe()
        process.standardOutput = output
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        #expect(process.terminationStatus == 0)
        #expect(String(decoding: data, as: UTF8.self).split(separator: "\n").map(String.init) == ["simctl", "keychain", id, "add-root-cert", path])
    }

    @Test func simulatorDoesNotPresentSelectedRoutingAsVerifiedRouting() throws {
        let guide = ProxyDeviceSetupGuide.guide(target: .simulator, port: 8081, allowLAN: false, certificatePath: nil, routeThisMac: true)
        let route = try #require(guide.steps.first { $0.id == "route" })
        #expect(route.detail.contains("confirm Hakka reports"))
        #expect(guide.steps.first { $0.id == "certificate" }?.command == nil)
        #expect(guide.verification.contains("does not verify this target"))
    }

    @Test func physicalDeviceRequiresLANAndAvoidsLoopbackServer() throws {
        let guide = ProxyDeviceSetupGuide.guide(target: .iphone, port: 8081, allowLAN: false, certificatePath: nil, lanAddress: "127.0.0.1")
        #expect(guide.steps.first { $0.id == "network" }?.detail.contains("Enable Allow LAN") == true)
        let route = try #require(guide.steps.first { $0.id == "route" })
        #expect(route.detail.contains("Server to this Mac’s Wi-Fi address and Port to 8081"))
        #expect(guide.steps.first { $0.id == "certificate" }?.detail.contains("installation and full trust are separate") == true)
        #expect(guide.steps.first { $0.id == "restore" }?.detail.contains("does not change the device’s settings") == true)
    }

    @Test func physicalDeviceUsesProvidedLANAddress() {
        let guide = ProxyDeviceSetupGuide.guide(target: .iphone, port: 9090, allowLAN: true, certificatePath: nil, lanAddress: "192.168.1.12")
        #expect(guide.steps.first { $0.id == "route" }?.detail.contains("Server to 192.168.1.12 and Port to 9090") == true)
        #expect(guide.steps.first { $0.id == "network" }?.detail.contains("Allow LAN is selected") == true)
    }

    @Test func invalidPortProducesNoRunnableCommands() {
        for target in ProxyDeviceSetupGuide.Target.allCases {
            let guide = ProxyDeviceSetupGuide.guide(target: target, port: 65536, allowLAN: true, certificatePath: "/tmp/ca.pem")
            #expect(guide.steps.count == 1)
            #expect(guide.steps.allSatisfy { $0.command == nil })
        }
    }
}
