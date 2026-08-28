import SwiftUI
import HakkaUI

// MARK: - Network + Performance tabs

extension DemoView {
    var networkCommands: some View {
        VStack(spacing: 14) {
            commandSection("Methods", subtitle: "Exercise verbs and JSON bodies") {
                command("GET", "arrow.down.circle", .green) { fire("GET", "https://httpbin.org/get") }
                command("POST", "arrow.up.doc", .blue) { fire("POST", "https://httpbin.org/post") }
                command("PUT", "square.and.pencil", .purple) { fire("PUT", "https://httpbin.org/put") }
                command("PATCH", "bandage", .indigo) { fire("PATCH", "https://httpbin.org/patch") }
                command("DELETE", "trash", .red) { fire("DELETE", "https://httpbin.org/delete") }
                command("HEAD", "arrow.down.to.line", .teal) { fire("HEAD", "https://httpbin.org/get") }
            }

            commandSection("Payloads", subtitle: "Headers, bodies, bytes, and media") {
                command("JSON", "curlybraces", .indigo) { fire("GET", "https://httpbin.org/json") }
                command("Auth Headers", "key.horizontal", .pink) { fireAuth() }
                command("Image", "photo", .mint) { fire("GET", "https://httpbin.org/image/png") }
                command("Large Body", "shippingbox", .cyan) { fire("GET", "https://httpbin.org/bytes/100000") }
            }

            commandSection("Status Codes", subtitle: "Success, client, and server responses") {
                command("200", "checkmark.circle", .green) { fire("GET", "https://httpstat.us/200") }
                command("204", "circle.dashed", .teal) { fire("GET", "https://httpstat.us/204") }
                command("302", "arrow.triangle.turn.up.right.circle", .yellow) { fire("GET", "https://httpbin.org/redirect/3") }
                command("404", "exclamationmark.triangle", .orange) { fire("GET", "https://httpstat.us/404") }
                command("429", "timer", .orange) { fire("GET", "https://httpstat.us/429") }
                command("500", "xmark.octagon", .red) { fire("GET", "https://httpstat.us/500") }
            }

            commandSection("Failures + Timing", subtitle: "Slow paths and network errors") {
                command("Fast", "speedometer", .mint) { fire("GET", "https://httpbin.org/get") }
                command("1s Delay", "clock", .teal) { fire("GET", "https://httpbin.org/delay/1") }
                command("DNS", "wifi.slash", .red) { fire("GET", "https://nonexistent.invalid/api") }
                command("SSL", "lock.trianglebadge.exclamationmark", .red) { fire("GET", "https://expired.badssl.com/") }
            }
        }
        .animation(.snappy(duration: 0.24), value: selectedGroup)
    }

    var performanceCommands: some View {
        VStack(spacing: 14) {
            commandSection("Performance Monitor", subtitle: "Validate HUD, frame metrics, and latency summaries") {
                command("Show HUD", "macwindow.badge.plus", .cyan) { BubbleWindow.shared.show() }
                command("Dashboard", "chart.xyaxis.line", .mint) { OverlayWindow.shared.showMonitor() }
                command("Send 20", "bolt.badge.clock", .yellow) { rapidFire(20) }
                command("Large x4", "shippingbox.and.arrow.backward", .orange) {
                    for _ in 0..<4 { fire("GET", "https://httpbin.org/bytes/100000", label: "Large Body") }
                }
            }

            commandSection("Stress Mix", subtitle: "Combine network volume with slow and failed requests") {
                command("Latency Mix", "timer", .teal) {
                    fire("GET", "https://httpbin.org/get", label: "Fast")
                    fire("GET", "https://httpbin.org/delay/1", label: "Delay")
                    fire("GET", "https://httpstat.us/500", label: "Server Error")
                }
                command("Burst 50", "flame", .red) { rapidFire(50) }
                command("Failures", "wifi.exclamationmark", .red) {
                    fire("GET", "https://nonexistent.invalid/api", label: "DNS")
                    fire("GET", "https://expired.badssl.com/", label: "SSL")
                }
                command("Clear Logs", "trash.slash", .gray) { clearCapture() }
            }
        }
        .animation(.snappy(duration: 0.24), value: selectedGroup)
    }

    func rapidFire(_ count: Int) {
        let urls = [
            "https://httpbin.org/get",
            "https://jsonplaceholder.typicode.com/posts/1",
            "https://httpbin.org/json",
            "https://catfact.ninja/fact",
            "https://httpbin.org/status/204",
        ]
        for i in 0..<count {
            fire("GET", urls[i % urls.count], label: "Burst \(i + 1)")
        }
    }

    func allMethods() {
        fire("GET", "https://httpbin.org/get")
        fire("POST", "https://httpbin.org/post")
        fire("PUT", "https://httpbin.org/put")
        fire("PATCH", "https://httpbin.org/patch")
        fire("DELETE", "https://httpbin.org/delete")
    }

    func allStates() {
        fire("GET", "https://httpstat.us/200", label: "Status 200")
        fire("GET", "https://httpstat.us/204", label: "Status 204")
        fire("GET", "https://httpbin.org/redirect/3", label: "Redirect")
        fire("GET", "https://httpstat.us/404", label: "Status 404")
        fire("GET", "https://httpstat.us/500", label: "Status 500")
        fire("GET", "https://nonexistent.invalid/api", label: "DNS")
    }
}
