import Foundation

enum ProxySetupGuide {
    enum Target: String, CaseIterable, Identifiable {
        case mac = "This Mac", iphone = "iPhone or iPad", android = "Android"
        var id: String {
            rawValue
        }

        var instructions: String {
            switch self {
            case .mac:
                "Run the command below in Terminal to send a request through Hakka. For other apps, set their HTTP and HTTPS proxy to 127.0.0.1 and the capture port."
            case .iphone:
                "Connect to the same network as this Mac. In Settings → Wi-Fi → your network → Configure Proxy, choose Manual and enter this Mac’s address and capture port. Visit http://mitm.it in Safari, install the profile, then enable it in Settings → General → About → Certificate Trust Settings. Turn Configure Proxy off when finished."
            case .android:
                "Connect to the same network as this Mac. Edit the Wi-Fi network, choose Manual proxy, and enter this Mac’s address and capture port. Visit http://mitm.it to install the CA certificate. Apps targeting Android 7 or later generally need a debug network security configuration that trusts user certificates. Remove the Wi-Fi proxy when finished."
            }
        }
    }

    static func testCommand(port: Int, certificatePath: String?) -> String? {
        guard (1 ... 65535).contains(port) else { return nil }
        var command = "curl --noproxy '' --proxy http://127.0.0.1:\(port) --connect-timeout 5 --max-time 15"
        if let certificatePath {
            command += " --cacert " + quote(certificatePath)
            command += " https://example.com"
        } else {
            command += " http://example.com"
        }
        return command
    }

    private static func quote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
    }
}
