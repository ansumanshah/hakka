import SwiftUI
import HakkaNetwork

// MARK: - Shared network + activity-feed helpers
//
// Every scenario tab funnels its network traffic through `fire(_:_:label:)`
// so `HakkaInterceptor` (installed once in `HakkaDemoApp.init()`) captures
// it -- these are plain `URLSession` calls with no Hakka-specific code, the
// same way any host app's real traffic gets captured.

extension DemoView {
    func fire(_ method: String, _ urlString: String, label: String? = nil) {
        guard let url = URL(string: urlString) else { return }
        let title = label ?? method
        inFlightCount += 1
        lastEvent = "\(title) started"

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 8
        if ["POST", "PUT", "PATCH"].contains(method) {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(
                withJSONObject: [
                    "name": "Hakka",
                    "scenario": title,
                    "timestamp": Date().timeIntervalSince1970,
                ]
            )
        }

        URLSession.shared.dataTask(with: req) { _, response, error in
            DispatchQueue.main.async {
                inFlightCount = max(0, inFlightCount - 1)
                requestCount += 1

                let status = (response as? HTTPURLResponse)?.statusCode
                if let error {
                    pushEvent("\(title) failed", tint: .red)
                    lastEvent = error.localizedDescription
                } else if let status {
                    pushEvent("\(title) \(status)", tint: status < 400 ? .green : .orange)
                    lastEvent = "\(title) \(status)"
                } else {
                    pushEvent("\(title) captured", tint: .cyan)
                    lastEvent = "\(title) captured"
                }
            }
        }.resume()
    }

    func fireAuth() {
        guard let url = URL(string: "https://httpbin.org/bearer") else { return }
        inFlightCount += 1
        lastEvent = "Auth started"
        var req = URLRequest(url: url)
        req.setValue("Bearer eyJhbGciOiJIUzI1NiJ9.test", forHTTPHeaderField: "Authorization")
        req.setValue("session=abc123", forHTTPHeaderField: "Cookie")
        URLSession.shared.dataTask(with: req) { _, response, error in
            DispatchQueue.main.async {
                inFlightCount = max(0, inFlightCount - 1)
                requestCount += 1
                if error != nil {
                    pushEvent("Auth failed", tint: .red)
                    lastEvent = "Auth failed"
                } else {
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    pushEvent("Auth \(status)", tint: status < 400 ? .pink : .orange)
                    lastEvent = "Auth \(status)"
                }
            }
        }.resume()
    }

    func clearCapture() {
        HakkaInterceptor.shared.clear()
        requestCount = 0
        inFlightCount = 0
        recentEvents.removeAll()
        lastEvent = "Cleared"
    }

    func pushEvent(_ title: String, tint: Color) {
        recentEvents.insert(DemoEvent(title: title, tint: tint), at: 0)
        if recentEvents.count > 5 {
            recentEvents.removeLast(recentEvents.count - 5)
        }
    }
}
