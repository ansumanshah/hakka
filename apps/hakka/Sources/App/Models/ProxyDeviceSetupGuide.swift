import Foundation

/// Manual setup instructions; generating a guide never changes device or network settings.
enum ProxyDeviceSetupGuide {
    enum Target: String, CaseIterable, Identifiable {
        case mac = "This Mac"
        case simulator = "iOS Simulator"
        case iphone = "iPhone or iPad"
        case android = "Android"

        var id: String { rawValue }
    }

    struct Step: Identifiable, Equatable {
        let id: String
        let title: String
        let detail: String
        var command: String? = nil
    }

    struct Guide: Equatable {
        let steps: [Step]
        let limitations: [String]
        let verification: String
    }

    static func guide(
        target: Target, port: Int, allowLAN: Bool, certificatePath: String?,
        lanAddress: String? = nil, simulatorID: String? = nil, routeThisMac: Bool = false
    ) -> Guide {
        guard (1 ... 65535).contains(port) else {
            return Guide(steps: [Step(id: "port", title: "Choose a valid port", detail: "Use a capture port between 1 and 65535 before setting up this target.")],
                         limitations: [], verification: "Start capture before testing a target.")
        }
        let verification = "Open http://example.com on this target and find its new request in Live Traffic. Then open https://example.com and inspect a decrypted HTTPS request and response. Installing a certificate alone does not verify routing, trust, or HTTPS capture. The connection test in Hakka runs on this Mac, so it does not verify this target."
        switch target {
        case .mac:
            return Guide(steps: [
                Step(id: "route", title: "Choose how to route traffic", detail: "For apps that honor system proxy settings, explicitly enable Route this Mac before starting capture. You can instead configure an app’s HTTP and HTTPS proxy as 127.0.0.1:\(port)."),
                Step(id: "test", title: "Send a request", detail: "This command routes only its own request. Its public CA option verifies TLS without installing system trust.", command: ProxySetupGuide.testCommand(port: port, certificatePath: certificatePath)),
                Step(id: "restore", title: "Finish capture", detail: "Stop capture to restore the system proxy settings Hakka saved. Remove any proxy settings you manually added to an app."),
            ], limitations: ["Apps can ignore system proxy settings. Certificate pinning or a custom trust store can prevent HTTPS decryption."],
            verification: "Find the test request in Live Traffic. A successful curl request using --cacert verifies that request only; it does not establish system-wide certificate trust.")
        case .simulator:
            let installCommand = simulatorCertificateCommand(simulatorID: simulatorID, certificatePath: certificatePath)
            return Guide(steps: [
                Step(id: "route", title: "Route Simulator traffic", detail: routeThisMac
                     ? "Route this Mac is selected. Start capture and confirm Hakka reports that this Mac is routed before testing Simulator Safari. Simulator Safari commonly follows the Mac’s system proxy; runtime and app behavior can vary."
                     : "Simulator Safari commonly follows the Mac’s system proxy. Explicitly enable Route this Mac before starting capture, or manually set the Mac’s HTTP and HTTPS proxy to 127.0.0.1:\(port). This affects other Mac apps that honor system proxies. Hakka does not silently configure Simulator."),
                Step(id: "select", title: "Choose the Simulator", detail: "Boot the intended Simulator and obtain its UDID from xcrun simctl list devices booted. Select that exact target for certificate installation; each Simulator has its own trust store."),
                Step(id: "certificate", title: "Install the public CA in the target", detail: installCommand == nil
                     ? "Start capture to obtain the public CA path, then provide the intended Simulator UDID. Manually run xcrun simctl keychain <UDID> add-root-cert <public-CA-path>. This installs trust in that Simulator only; it does not prove HTTPS capture."
                     : "Run this command yourself to add the public CA to the selected Simulator’s trusted root store. It changes that target’s certificate trust; it does not prove HTTPS capture.", command: installCommand),
                Step(id: "verify", title: "Verify from Simulator Safari", detail: verification),
                Step(id: "restore", title: "Finish capture", detail: "Stop capture to restore proxy settings applied by Hakka. Restore any system proxy settings you changed manually. The installed CA remains in that Simulator independently of capture; manage its removal separately."),
            ], limitations: ["A Mac connection test does not prove Simulator traffic follows the proxy.", "Apps with certificate pinning, custom trust, or proxy bypass may not be captured. Recheck after changing Simulator runtime or network configuration."], verification: verification)
        case .iphone, .android:
            let address = usableLANAddress(lanAddress) ?? "this Mac’s Wi-Fi address"
            let route = "Connect the device and Mac to the same reachable network. " + (allowLAN
                ? "Allow LAN is selected; start capture to listen for device connections."
                : "Enable Allow LAN before starting capture; loopback-only capture cannot receive physical-device traffic.")
            let certificate = target == .iphone
                ? "In Safari on the device, visit http://mitm.it through the configured proxy and download its CA profile. Install it in Settings → General → VPN & Device Management (or Profile Downloaded), then enable full trust in Settings → General → About → Certificate Trust Settings. Profile installation and full trust are separate steps."
                : "Visit http://mitm.it through the configured proxy and install the CA certificate. Apps targeting Android 7 or later generally require a debug network security configuration that trusts user certificates."
            let configure = target == .iphone
                ? "In Settings → Wi-Fi → the connected network’s info button → Configure Proxy, choose Manual. Set Server to \(address) and Port to \(port), then save. Do not use 127.0.0.1; that address refers to the device itself."
                : "Edit the connected Wi-Fi network, choose Manual proxy, and set host to \(address) and port to \(port). Do not use 127.0.0.1; that address refers to the device itself."
            return Guide(steps: [
                Step(id: "network", title: "Allow device connections", detail: route),
                Step(id: "route", title: "Set the Wi-Fi proxy", detail: "Record the existing Wi-Fi proxy settings before changing them. " + configure),
                Step(id: "certificate", title: "Install and trust the public CA", detail: certificate),
                Step(id: "verify", title: "Verify on the device", detail: verification),
                Step(id: "restore", title: "Finish capture", detail: "Restore the Wi-Fi proxy settings recorded before capture (choose Off only if it was previously off). Remove the installed CA profile or certificate when no longer needed. Stopping Hakka does not change the device’s settings."),
            ], limitations: ["Wi-Fi proxy settings do not route cellular traffic. VPNs, firewall rules, and Wi-Fi client isolation can block access to the Mac.", "Apps can bypass proxies or reject the CA through certificate pinning or custom trust. Capture only hosts allowed by Hakka’s TLS settings."], verification: verification)
        }
    }

    static func simulatorCertificateCommand(simulatorID: String?, certificatePath: String?) -> String? {
        guard let simulatorID, UUID(uuidString: simulatorID) != nil,
              let certificatePath, !certificatePath.isEmpty else { return nil }
        return "xcrun simctl keychain \(quote(simulatorID)) add-root-cert \(quote(certificatePath))"
    }

    private static func usableLANAddress(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("127."), trimmed != "localhost", trimmed != "::1", trimmed != "0.0.0.0" else { return nil }
        return trimmed
    }

    private static func quote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
    }
}
