import Foundation

struct ProxyConnectionProbe: Sendable {
    struct Result: Equatable, Sendable {
        let succeeded: Bool
        let message: String
    }

    let port: Int
    let certificatePath: String?

    func run() async -> Result {
        guard (1 ... 65535).contains(port) else {
            return Result(succeeded: false, message: "Choose a valid proxy port before testing.")
        }
        let arguments = arguments
        return await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
                process.arguments = arguments
                process.standardInput = FileHandle.nullDevice
                process.standardOutput = FileHandle.nullDevice
                process.standardError = FileHandle.nullDevice
                do {
                    try process.run()
                    process.waitUntilExit()
                    continuation.resume(returning: Self.result(exitCode: process.terminationStatus))
                } catch {
                    continuation.resume(returning: Result(succeeded: false, message: "Could not launch the connection test: \(error.localizedDescription)"))
                }
            }
        }
    }

    var arguments: [String] {
        var values = ["--disable", "--silent", "--show-error", "--fail", "--noproxy", "", "--proxy", "http://127.0.0.1:\(port)", "--connect-timeout", "5", "--max-time", "15", "--output", "/dev/null"]
        if let certificatePath {
            values += ["--cacert", certificatePath, "https://example.com"]
        } else {
            values.append("http://example.com")
        }
        return values
    }

    static func result(exitCode: Int32) -> Result {
        switch exitCode {
        case 0: Result(succeeded: true, message: "Request succeeded through this Mac’s proxy. Find example.com in Live Traffic.")
        case 5, 6: Result(succeeded: false, message: "DNS lookup failed. Check this Mac’s internet connection and proxy diagnostics.")
        case 7: Result(succeeded: false, message: "Could not connect. Check that capture is running on the configured port.")
        case 22: Result(succeeded: false, message: "The server returned an HTTP error. Inspect example.com in Live Traffic for the response.")
        case 28: Result(succeeded: false, message: "The connection test timed out after 15 seconds. Check connectivity and any active proxy rules.")
        case 35, 60: Result(succeeded: false, message: "HTTPS verification failed. Check the public certificate and TLS settings; certificate verification remains enabled.")
        case 77: Result(succeeded: false, message: "The public certificate could not be read. Restart capture to refresh its location.")
        default: Result(succeeded: false, message: "Connection test failed (curl code \(exitCode)). Check the proxy status and Live Traffic.")
        }
    }
}
