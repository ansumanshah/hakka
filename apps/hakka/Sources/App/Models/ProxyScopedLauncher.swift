import Foundation

/// Starts one explicitly selected executable with proxy and certificate settings
/// in its environment only. It does not edit application preferences or profiles.
enum ProxyScopedLauncher {
    static func launch(executable: URL, arguments: [String] = [], port: Int, certificatePath: String?) throws -> Process {
        let executable = Bundle(url: executable)?.executableURL ?? executable
        guard executable.isFileURL, FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw CocoaError(.fileNoSuchFile)
        }
        let proxyURL = "http://127.0.0.1:\(port)"
        var environment = ProcessInfo.processInfo.environment
        environment["http_proxy"] = proxyURL
        environment["https_proxy"] = proxyURL
        environment["HTTP_PROXY"] = proxyURL
        environment["HTTPS_PROXY"] = proxyURL
        if let certificatePath {
            environment["NODE_EXTRA_CA_CERTS"] = certificatePath
            environment["SSL_CERT_FILE"] = certificatePath
            environment["REQUESTS_CA_BUNDLE"] = certificatePath
        }
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.environment = environment
        try process.run()
        return process
    }
}
