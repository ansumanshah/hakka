import HakkaCore
import SwiftUI

/// Finite WebSocket/SSE collection sessions. Leaving this disabled preserves
/// the live socket console and ordinary one-shot request behavior.
struct RequestSessionTabView: View {
    @Binding var spec: RequestSpec

    var body: some View {
        Form {
            Toggle("Run as bounded session", isOn: enabled)
            if let session = spec.session {
                switch session {
                case var .webSocket(webSocket):
                    Picker("Transport", selection: Binding(
                        get: { "webSocket" },
                        set: { if $0 == "sse" { spec.session = .sse(SSESessionSpec()) } },
                    )) { Text("WebSocket").tag("webSocket"); Text("SSE").tag("sse") }
                    Stepper("Receive frames: \(webSocket.maxFrames)", value: Binding(get: { webSocket.maxFrames }, set: { webSocket.maxFrames = $0; spec.session = .webSocket(webSocket) }), in: 1...10_000)
                    Stepper("Deadline: \(webSocket.timeoutMs) ms", value: Binding(get: { webSocket.timeoutMs }, set: { webSocket.timeoutMs = $0; spec.session = .webSocket(webSocket) }), in: 1_000...3_600_000, step: 1_000)
                case var .sse(sse):
                    Picker("Transport", selection: Binding(
                        get: { "sse" },
                        set: { if $0 == "webSocket" { spec.session = .webSocket(WebSocketSessionSpec()) } },
                    )) { Text("WebSocket").tag("webSocket"); Text("SSE").tag("sse") }
                    Stepper("Receive events: \(sse.maxEvents)", value: Binding(get: { sse.maxEvents }, set: { sse.maxEvents = $0; spec.session = .sse(sse) }), in: 1...10_000)
                    Stepper("Deadline: \(sse.timeoutMs) ms", value: Binding(get: { sse.timeoutMs }, set: { sse.timeoutMs = $0; spec.session = .sse(sse) }), in: 1_000...3_600_000, step: 1_000)
                }
            }
        }
        .formStyle(.grouped)
    }

    private var enabled: Binding<Bool> {
        Binding(get: { spec.session != nil }, set: { spec.session = $0 ? .webSocket(WebSocketSessionSpec()) : nil })
    }
}
