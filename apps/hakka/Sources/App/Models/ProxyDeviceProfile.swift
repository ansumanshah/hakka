import CryptoKit
import Darwin
import Foundation
import Security

/// Operator-prepared network identity; credentials never enter the setup transport.
struct ProxyDeviceNetwork: Equatable {
    let ssid: String
    let security: String

    static func parse(_ data: Data) throws -> Self {
        guard data.count <= 2048,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == Set(["ssid", "security"]),
              let ssid = object["ssid"] as? String, !ssid.isEmpty, ssid.utf8.count <= 32,
              !ssid.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              let security = object["security"] as? String,
              ["None", "WPA", "WPA2", "WPA3"].contains(security)
        else { throw ProxyDeviceSetupError.invalidNetwork }
        return Self(ssid: ssid, security: security)
    }

    static func load(directory: URL) throws -> Self {
        var directoryInfo = stat()
        guard lstat(directory.path, &directoryInfo) == 0,
              directoryInfo.st_mode & S_IFMT == S_IFDIR,
              directoryInfo.st_mode & 0o777 == 0o700, directoryInfo.st_uid == getuid()
        else { throw ProxyDeviceSetupError.privateNetworkFile }
        let url = directory.appendingPathComponent("physical-device-network.json")
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw ProxyDeviceSetupError.privateNetworkFile }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_mode & 0o777 == 0o600, info.st_uid == getuid(), info.st_size <= 2048
        else { throw ProxyDeviceSetupError.privateNetworkFile }
        var buffer = [UInt8](repeating: 0, count: 2049)
        let count = read(descriptor, &buffer, buffer.count)
        guard count >= 0, count <= 2048 else { throw ProxyDeviceSetupError.invalidNetwork }
        return try parse(Data(buffer.prefix(count)))
    }
}

enum ProxyDeviceSetupError: Error, LocalizedError {
    case invalidNetwork, privateNetworkFile, invalidCertificate, unavailable, denied, invalidAddress, invalidArguments
    var errorDescription: String? {
        switch self {
        case .invalidNetwork: "Prepare physical-device-network.json with only ssid (1–32 UTF-8 bytes) and security (None, WPA, WPA2 or WPA3 Personal). Credentials are entered on the phone."
        case .privateNetworkFile: "The operator must prepare physical-device-network.json in the proxy configuration directory, owned by this user, with directory mode 0700 and regular non-symlink file mode 0600."
        case .invalidCertificate: "A single valid public CA PEM certificate is required. Private keys are forbidden."
        case .unavailable: "The LAN setup listener is unavailable."
        case .denied: "Enable Allow agents in the Proxy Capture window."
        case .invalidAddress: "Select an exact active LAN IPv4 address on this Mac."
        case .invalidArguments: "Unexpected or invalid tool arguments."
        }
    }
}

struct ProxyDeviceProfile {
    let data: Data
    let fingerprint: String

    init(publicPEM: Data, network: ProxyDeviceNetwork, address: String, port: Int) throws {
        guard (1...65535).contains(port), publicPEM.count <= 65536,
              let pem = String(data: publicPEM, encoding: .utf8), !pem.contains("PRIVATE KEY")
        else { throw ProxyDeviceSetupError.invalidCertificate }
        let begin = "-----BEGIN CERTIFICATE-----", end = "-----END CERTIFICATE-----"
        let pieces = pem.components(separatedBy: begin)
        guard pieces.count == 2, pieces[0].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ProxyDeviceSetupError.invalidCertificate
        }
        let tail = pieces[1].components(separatedBy: end)
        guard tail.count == 2, tail[1].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let der = Data(base64Encoded: tail[0].components(separatedBy: .whitespacesAndNewlines).joined()),
              SecCertificateCreateWithData(nil, der as CFData) != nil
        else { throw ProxyDeviceSetupError.invalidCertificate }
        fingerprint = SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined()
        func payload(_ type: String, _ title: String) -> [String: Any] {
            let id = UUID().uuidString
            return ["PayloadType": type, "PayloadVersion": 1, "PayloadIdentifier": "app.hakka.device.\(id)",
                    "PayloadUUID": id, "PayloadDisplayName": title]
        }
        var ca = payload("com.apple.security.root", "Hakka Public CA")
        ca["PayloadContent"] = der
        var wifi = payload("com.apple.wifi.managed", "Hakka Wi-Fi Proxy")
        wifi.merge(["SSID_STR": network.ssid, "EncryptionType": network.security, "AutoJoin": false,
                    "ProxyType": "Manual", "ProxyServer": address, "ProxyServerPort": port]) { _, value in value }
        var profile = payload("Configuration", "Hakka Temporary Device Setup")
        profile["PayloadRemovalDisallowed"] = false
        profile["PayloadDescription"] = "Temporary Wi-Fi proxy and public CA. Remove this profile when finished."
        profile["PayloadContent"] = [ca, wifi]
        data = try PropertyListSerialization.data(fromPropertyList: profile, format: .xml, options: 0)
    }
}
