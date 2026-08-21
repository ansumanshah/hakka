import HakkaCommon
import HakkaCore
import SwiftUI

/// The WebSocket frame console: lifecycle banner + connect/disconnect
/// controls, the frame list, and a composer to send a text frame on the
/// open connection. Shown by `DetailPaneView` in place of the normal
/// send/response view whenever the request editor's draft URL is `ws://`/
/// `wss://` — a live connection has many events, not one response, so it
/// never routes through `NetworkRequestDetailView`/`RunResult`.
struct DetailFramesTabView: View {
    let model: WebSocketConnectionModel
    let url: String

    @State private var composerText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            lifecycleBar
            if let connectError = model.connectError {
                Text(connectError)
                    .font(.caption)
                    .foregroundStyle(ThemeTokens.Status.error)
            }
            frameList
            composer
        }
    }

    private var lifecycleBar: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(stateColor)
                .frame(width: 8, height: 8)
            Text(stateLabel)
                .font(.caption.weight(.semibold))
            if model.snapshot.droppedFrameCount > 0 {
                Text("\(model.snapshot.droppedFrameCount) frame(s) dropped past the capture limit")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if model.state.isOpen {
                Button("Disconnect", role: .destructive) { model.disconnect() }
                    .controlSize(.small)
            } else {
                Button("Connect") { model.connect(urlString: url) }
                    .controlSize(.small)
                    .disabled(model.state == .connecting)
            }
        }
        .font(.caption)
    }

    @ViewBuilder
    private var frameList: some View {
        if model.snapshot.frames.isEmpty {
            Text("No frames yet")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color.secondary.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 4))
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(model.snapshot.frames) { frame in
                        WebSocketFrameRow(frame: frame)
                    }
                }
            }
            .frame(maxHeight: 320)
        }
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("Send a text frame…", text: $composerText)
                .textFieldStyle(.roundedBorder)
                .onSubmit(send)
                .disabled(!model.state.isOpen)
            Button("Send", action: send)
                .disabled(!model.state.isOpen || composerText.isEmpty)
        }
    }

    private func send() {
        guard model.state.isOpen, !composerText.isEmpty else { return }
        model.send(text: composerText)
        composerText = ""
    }

    private var stateLabel: String {
        switch model.state {
        case .idle: "Not connected"
        case .connecting: "Connecting…"
        case let .open(wsProtocol): wsProtocol.map { "Open (\($0))" } ?? "Open"
        case let .closed(code): "Closed (\(code))"
        case let .failed(message): "Failed: \(message)"
        }
    }

    private var stateColor: Color {
        switch model.state {
        case .idle: ThemeTokens.Status.pending
        case .connecting: ThemeTokens.Status.warning
        case .open: ThemeTokens.Status.success
        case .closed: ThemeTokens.Status.pending
        case .failed: ThemeTokens.Status.error
        }
    }
}

/// One frame row: direction arrow, opcode, size, and the payload — text
/// verbatim, or `"‹n bytes›"` for a binary frame past
/// `WebSocketCaps.perFramePayloadBytes`, matching how the SDK's own capture
/// (`WsMessage`) represents a capped binary payload.
private struct WebSocketFrameRow: View {
    let frame: WebSocketFrame

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: frame.direction == .sent ? "arrow.up.circle" : "arrow.down.circle")
                .foregroundStyle(frame.direction == .sent ? ThemeTokens.Status.info : ThemeTokens.Status.success)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(frame.opcode.rawValue) · \(frame.size) bytes")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                Text(payloadText)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .lineLimit(4)
            }
        }
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    private var payloadText: String {
        switch frame.payload {
        case let .text(text): text
        case let .byteCount(count): "‹\(count) bytes›"
        }
    }
}
