import Foundation
import AppKit
import HakkaServer
import HakkaCommon
import Testing
import Vision
@testable import HakkaApp

@Suite("Physical device setup")
@MainActor
struct ProxyDeviceProfileTests {
    @Test func networkRejectsUnknownFieldsAndUnsupportedSecurity() throws {
        #expect(throws: (any Error).self) { try ProxyDeviceNetwork.parse(Data(#"{"ssid":"Home","security":"WPA2","password":"secret"}"#.utf8)) }
        #expect(throws: (any Error).self) { try ProxyDeviceNetwork.parse(Data(#"{"ssid":"Home","security":"Any"}"#.utf8)) }
        #expect(throws: (any Error).self) { try ProxyDeviceNetwork.parse(Data(#"{"ssid":"","security":"None"}"#.utf8)) }
        #expect(try ProxyDeviceNetwork.parse(Data(#"{"ssid":"Home","security":"WPA3"}"#.utf8)).security == "WPA3")
    }

    @Test func privateFileRejectsLoosePermissionsAndSymlink() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("physical-device-network.json")
        try Data(#"{"ssid":"Home","security":"WPA2"}"#.utf8).write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
        #expect(throws: (any Error).self) { try ProxyDeviceNetwork.load(directory: directory) }
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        #expect(try ProxyDeviceNetwork.load(directory: directory).ssid == "Home")
        let other = directory.appendingPathComponent("other.json")
        try FileManager.default.moveItem(at: file, to: other)
        try FileManager.default.createSymbolicLink(at: file, withDestinationURL: other)
        #expect(throws: (any Error).self) { try ProxyDeviceNetwork.load(directory: directory) }
    }

    @Test func profileContainsOnlyRemovablePublicCAAndSSIDProxy() throws {
        let profile = try ProxyDeviceProfile(publicPEM: Data(Self.certificate.utf8), network: .init(ssid: "Home", security: "WPA2"), address: "192.168.1.2", port: 8080)
        let plist = try #require(PropertyListSerialization.propertyList(from: profile.data, format: nil) as? [String: Any])
        #expect(plist["PayloadRemovalDisallowed"] as? Bool == false)
        let payloads = try #require(plist["PayloadContent"] as? [[String: Any]])
        #expect(payloads.count == 2)
        let wifi = try #require(payloads.first { $0["PayloadType"] as? String == "com.apple.wifi.managed" })
        #expect(wifi["SSID_STR"] as? String == "Home")
        #expect(wifi["ProxyType"] as? String == "Manual")
        #expect(wifi["ProxyServerPort"] as? Int == 8080)
        #expect(wifi["Password"] == nil)
        #expect(!String(decoding: profile.data, as: UTF8.self).contains("PRIVATE KEY"))
        #expect(profile.fingerprint.count == 64)
        #expect(throws: (any Error).self) { try ProxyDeviceProfile(publicPEM: Data((Self.certificate + "PRIVATE KEY").utf8), network: .init(ssid: "Home", security: "None"), address: "192.168.1.2", port: 8080) }
    }

    @Test func malformedArgumentsAndRevokedGateDoNotStartListener() async {
        let proxy = ProxyCaptureModel(), traffic = TrafficModel(), model = ProxyDeviceSetupModel()
        let tools = NativeDeviceSetupTool.tools(model: model, proxy: proxy, traffic: traffic)
        for name in ["proxy_device_capture_start", "proxy_device_setup", "proxy_device_setup_stop"] {
            let tool = tools.first { $0.name == name }!
            let invalid = await tool.call(.object(["unexpected": .bool(true)]))
            #expect(invalid.isError)
        }
        let start = tools.first { $0.name == "proxy_device_setup" }!
        #expect(await start.call(.object(["address": .string("192.168.1.2")])).isError)
        #expect(await start.call(.object(["address": .string("127.0.0.1")])).isError)
    }

    @Test func nonceEvidenceRequiresNewSuccessfulResponse() throws {
        let url = "https://example.com/?hakka_device_setup=testnonce"
        func request(id: String = "new", status: Int = 200, body: String = "ok", error: String? = nil) throws -> NetworkRequest {
            var object: [String: Any] = ["id": id, "url": url, "method": "GET", "startTime": 1000, "status": status, "responseBody": body]
            if let error { object["error"] = error }
            return try JSONDecoder().decode(NetworkRequest.self, from: JSONSerialization.data(withJSONObject: object))
        }
        #expect(ProxyDeviceSetupModel.matches(try request(), url: url, started: 1000, existingIDs: ["old"]))
        for rejected in [try request(id: "old"), try request(status: 500), try request(body: ""), try request(error: "TLS failed")] {
            #expect(!ProxyDeviceSetupModel.matches(rejected, url: url, started: 1000, existingIDs: ["old"]))
        }
        #expect(!ProxyDeviceSetupModel.matches(try request(), url: url + "different", started: 1000, existingIDs: []))
    }

    @Test func serverRequiresNonceAndExpires() async throws {
        let server = ProxyDeviceSetupServer()
        let token = String(repeating: "a", count: 32)
        // Serve with a long lifetime so a busy main actor on CI cannot expire
        // the listener mid-request; expiry is covered separately below.
        let link = try await server.start(address: "127.0.0.1", profile: Data("public-profile".utf8), token: token, testURL: "https://example.com/?hakka_device_setup=\(token)", lifetime: 60)
        let base = try #require(URL(string: link))
        let invalid = try await Self.get(URL(string: "/wrong/profile.mobileconfig", relativeTo: base)!)
        #expect(invalid.status == 404)
        let downloadURL = try #require(URL(string: "/\(token)/profile.mobileconfig", relativeTo: base))
        let downloaded = try await Self.get(downloadURL)
        #expect(downloaded.status == 200)
        #expect(downloaded.contentType?.contains("application/x-apple-aspen-config") == true)
        #expect(downloaded.body == Data("public-profile".utf8))
        #expect(String(decoding: server.response(to: Data("GET /\(token)/profile.mobileconfig HTTP/1.1\r\nHost: local\r\n\r\n".utf8), now: Date().addingTimeInterval(61)), as: UTF8.self).contains("404"))

        let expiring = ProxyDeviceSetupServer()
        let expiringLink = try await expiring.start(address: "127.0.0.1", profile: Data("public-profile".utf8), token: token, testURL: "https://example.com/?hakka_device_setup=\(token)", lifetime: 0.2)
        for _ in 0 ..< 200 where expiring.link != nil { try await Task.sleep(for: .milliseconds(50)) }
        #expect(expiring.link == nil)
        do {
            _ = try await Self.get(URL(string: "/\(token)/profile.mobileconfig", relativeTo: URL(string: expiringLink))!)
            Issue.record("An expired profile listener still served the download")
        } catch {}
        server.stop()
        #expect(server.link == nil)
    }

    @Test func setupQRCodeDecodesToTheExactCapabilityURL() throws {
        let link = "http://192.0.2.42:49152/0123456789abcdef0123456789abcdef"
        let original = MCPToolResult.json(.object(["setupLink": .string(link)]))
        let result = ProxyDeviceSetupQRCode.append(to: original, link: link)
        #expect(result.content.first == original.content.first)
        let imageBlock = try #require(result.content.last?.objectValue)
        #expect(imageBlock["type"]?.stringValue == "image")
        #expect(imageBlock["mimeType"]?.stringValue == "image/png")
        let encoded = try #require(imageBlock["data"]?.stringValue)
        let png = try #require(Data(base64Encoded: encoded))
        let image = try #require(NSImage(data: png))
        var rect = CGRect(origin: .zero, size: image.size)
        let cgImage = try #require(image.cgImage(forProposedRect: &rect, context: nil, hints: nil))
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        try VNImageRequestHandler(cgImage: cgImage).perform([request])
        #expect(request.results?.first?.payloadStringValue == link)
    }

    private struct HTTPResponse {
        let status: Int
        let contentType: String?
        let body: Data
    }

    private static func get(_ url: URL) async throws -> HTTPResponse {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 2
        let (body, response) = try await URLSession.shared.data(for: request)
        let http = try #require(response as? HTTPURLResponse)
        return HTTPResponse(status: http.statusCode, contentType: http.value(forHTTPHeaderField: "Content-Type"), body: body)
    }

    private static let certificate = """
    -----BEGIN CERTIFICATE-----
    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
    jLMi6Et8Vcad+qMUu2WFbm5PEn4KPJ2V
    -----END CERTIFICATE-----
    """
}
