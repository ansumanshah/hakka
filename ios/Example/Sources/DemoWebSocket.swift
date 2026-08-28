import SwiftUI

// MARK: - WebSocket Echo demo
//
// `HakkaWebSocketMonitor` (`ios/Sources/Network/WebSocketMonitor.swift`)
// captures a `URLSessionWebSocketTask` by swizzling `URLSession`'s
// `webSocketTask(with:)` factory methods -- but only once
// `HakkaInterceptor.shared.enableNativeWebSocket()` has installed it, which
// `HakkaDemoApp.init()` does up front. Every frame sent and received is
// recorded, and the whole connection is emitted as one `NetworkRequest`
// when it closes -- so this demo sends one frame, waits for the echo, then
// closes, the same shape a real client/server exchange would have.
extension DemoView {
    func fireWebSocketDemo() {
        guard let url = URL(string: "wss://ws.postman-echo.com/raw") else { return }
        lastEvent = "WebSocket started"

        let task = URLSession.shared.webSocketTask(with: url)
        task.resume()
        task.send(.string("Hello from Hakka iOS demo")) { error in
            DispatchQueue.main.async {
                if let error {
                    pushEvent("WebSocket send failed", tint: .red)
                    lastEvent = error.localizedDescription
                    task.cancel(with: .abnormalClosure, reason: nil)
                    return
                }
                task.receive { result in
                    DispatchQueue.main.async {
                        requestCount += 1
                        switch result {
                        case .success:
                            pushEvent("WebSocket echo received", tint: .blue)
                            lastEvent = "WebSocket echo. Open the Frames tab."
                        case .failure(let error):
                            pushEvent("WebSocket receive failed", tint: .red)
                            lastEvent = error.localizedDescription
                        }
                        task.cancel(with: .normalClosure, reason: nil)
                    }
                }
            }
        }
    }
}
