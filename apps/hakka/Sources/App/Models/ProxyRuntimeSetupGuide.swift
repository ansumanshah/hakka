import Foundation

enum ProxyRuntime: String, CaseIterable, Identifiable {
    case pythonRequests
    case nodeUndici
    case curl

    var id: Self {
        self
    }

    var title: String {
        switch self {
        case .pythonRequests: "Python requests"
        case .nodeUndici: "Node.js undici"
        case .curl: "curl"
        }
    }

    var prerequisite: String {
        switch self {
        case .pythonRequests: "Requires Python 3 and requests: python3 -m pip install requests"
        case .nodeUndici: "Requires Node.js and a project dependency: npm install undici"
        case .curl: "Requires curl."
        }
    }
}

struct ProxyRuntimeSetupGuide {
    let port: Int
    let certificatePath: String

    init?(port: Int, certificatePath: String?) {
        guard (1 ... 65535).contains(port), let certificatePath, !certificatePath.isEmpty else { return nil }
        self.port = port
        self.certificatePath = certificatePath
    }

    func command(for runtime: ProxyRuntime) -> String {
        let proxy = Self.shellQuote("http://127.0.0.1:\(port)")
        let certificate = Self.shellQuote(certificatePath)
        switch runtime {
        case .pythonRequests:
            return "REQUESTS_CA_BUNDLE=\(certificate) HTTPS_PROXY=\(proxy) https_proxy=\(proxy) HTTP_PROXY=\(proxy) http_proxy=\(proxy) ALL_PROXY='' all_proxy='' NO_PROXY='' no_proxy='' python3 -c 'import requests; print(requests.get(\"https://example.com\", timeout=10).status_code)'"
        case .nodeUndici:
            return "NODE_EXTRA_CA_CERTS=\(certificate) node --input-type=module -e 'import { ProxyAgent, fetch } from \"undici\"; const dispatcher = new ProxyAgent(\"http://127.0.0.1:\(port)\"); try { const response = await fetch(\"https://example.com\", { dispatcher, signal: AbortSignal.timeout(15000) }); console.log(response.status) } finally { await Promise.race([dispatcher.close(), new Promise(resolve => setTimeout(resolve, 1000))]) }'"
        case .curl:
            return "curl --disable --noproxy '' --proxy \(proxy) --cacert \(certificate) --connect-timeout 5 --max-time 15 --head https://example.com"
        }
    }

    /// POSIX single quotes preserve paths without interpreting shell metacharacters.
    static func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\"'\"'"))'"
    }
}
