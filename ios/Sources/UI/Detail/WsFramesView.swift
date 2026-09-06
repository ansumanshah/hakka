#if canImport(UIKit)
import HakkaCommon
import SwiftUI
import UIKit

// MARK: - WsFramesView

/// Frames tab for a captured WebSocket connection.
/// Shows every recorded frame with direction, timestamp delta, size, and payload.
struct WsFramesView: View {
    let request: NetworkRequest

    var body: some View {
        let frames = request.messages ?? []
        if frames.isEmpty {
            emptyState
        } else {
            frameList(frames: frames)
        }
    }

    // MARK: - Empty

    private var emptyState: some View {
        VStack(spacing: Theme.s8) {
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.title2)
                .foregroundStyle(Theme.textTertiary)
            Text("No frames captured")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.s16 * 2)
    }

    // MARK: - Frame list

    private func frameList(frames: [WsMessage]) -> some View {
        VStack(alignment: .leading, spacing: Theme.s12) {
            summaryRow(frames: frames)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(frames.enumerated()), id: \.offset) { index, frame in
                    FrameRow(frame: frame, index: index, baseTime: request.startTime, wsProtocol: request.wsProtocol)
                    if index < frames.count - 1 {
                        Divider()
                            .background(Theme.border.opacity(0.35))
                            .padding(.leading, Theme.s16 + 14)
                    }
                }
            }
            .hakkaGroupedCard(padding: 0, cornerRadius: Theme.radiusL)
        }
    }

    // MARK: - Summary row

    private func summaryRow(frames: [WsMessage]) -> some View {
        let sent = frames.filter { $0.direction == .sent }.count
        let received = frames.count - sent
        return HStack(spacing: Theme.s12) {
            if let proto = request.wsProtocol, !proto.isEmpty {
                Label(proto, systemImage: "chevron.left.forwardslash.chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Theme.info)
            }
            HStack(spacing: Theme.s6) {
                Image(systemName: "arrow.up")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Theme.methodPut)
                Text("\(sent)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                Image(systemName: "arrow.down")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Theme.success)
                Text("\(received)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Text("\(frames.count) frames")
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
        }
        .padding(.horizontal, Theme.s4)
    }
}

// MARK: - FrameRow

private struct FrameRow: View {
    let frame: WsMessage
    let index: Int
    let baseTime: Int64
    let wsProtocol: String?

    /// Sub-protocol frame decode (MQTT/Socket.IO/STOMP/graphql-ws), or `nil`
    /// when no registered decoder recognises this frame.
    private var decoded: WsFrameInfo? {
        decodeWsFrame(frame.data, binary: frame.binary, wsProtocol: wsProtocol)
    }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.s10) {
            directionIndicator
            VStack(alignment: .leading, spacing: Theme.s4) {
                metaLine
                payloadLine
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, Theme.s12)
        .padding(.vertical, Theme.s10)
        .contentShape(Rectangle())
        .contextMenu {
            Button {
                UIPasteboard.general.string = copyablePayload
                Haptics.light()
            } label: {
                Label("Copy Payload", systemImage: "doc.on.doc")
            }
        }
    }

    // MARK: - Direction indicator

    private var directionIndicator: some View {
        let isSent = frame.direction == .sent
        return Text(isSent ? "↑" : "↓")
            .font(.system(size: HakkaMetrics.FontSize.md, weight: .bold, design: .monospaced))
            .foregroundStyle(isSent ? Theme.methodPut : Theme.success)
            .frame(width: 14, alignment: .center)
    }

    // MARK: - Meta line: time delta + size + binary badge

    private var metaLine: some View {
        HStack(spacing: Theme.s8) {
            Text(formatDelta(frame.timestamp - baseTime))
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.textTertiary)

            Text(Fmt.formatBytes(Int64(frame.size)))
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.textTertiary)

            if frame.binary {
                Text("binary")
                    .font(.system(size: HakkaMetrics.FontSize.xxs, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, Theme.s4)
                    .padding(.vertical, 1)
                    .background(Theme.surfaceRaised)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
            }

            if let decoded {
                Text(decoded.kind)
                    .font(.system(size: HakkaMetrics.FontSize.xxs, weight: .semibold))
                    .foregroundStyle(Theme.info)
                    .padding(.horizontal, Theme.s4)
                    .padding(.vertical, 1)
                    .background(Theme.info.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
            }
        }
    }

    // MARK: - Payload line

    private var payloadLine: some View {
        Text(displayPayload)
            .font(.caption2.monospaced())
            .foregroundStyle(Theme.text)
            .lineLimit(3)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Helpers

    private var displayPayload: String {
        if let decoded {
            guard let preview = decoded.payloadPreview, !preview.isEmpty else { return decoded.summary }
            return "\(decoded.summary) · \(preview)"
        }
        switch frame.data {
        case .text(let s):
            let limit = 300
            return s.count > limit ? String(s.prefix(limit)) + "…" : s
        case .byteCount(let n):
            return "<binary: \(n) bytes>"
        }
    }

    private var copyablePayload: String {
        switch frame.data {
        case .text(let s): return s
        case .byteCount(let n): return "<binary: \(n) bytes>"
        }
    }

    private func formatDelta(_ ms: Int64) -> String {
        if ms < 0 { return "+0ms" }
        if ms < 1_000 { return "+\(ms)ms" }
        let secs = Double(ms) / 1_000.0
        return String(format: "+%.2fs", secs)
    }
}

// MARK: - Previews

#if DEBUG
extension PreviewData {
    static let wsRequest: NetworkRequest = {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return NetworkRequest(
            id: "ws1",
            url: "wss://api.example.com/socket",
            method: .get,
            status: 101,
            startTime: now - 10_000,
            duration: 10_000,
            source: .nativeWebSocket,
            wsMessageCount: 4,
            wsCloseCode: 1000,
            messages: [
                WsMessage(timestamp: now - 9_800, direction: .sent,
                          data: .text("{\"type\":\"subscribe\",\"id\":\"1\"}"), size: 35),
                WsMessage(timestamp: now - 9_600, direction: .received,
                          data: .text("{\"type\":\"connection_ack\"}"), size: 24),
                WsMessage(timestamp: now - 5_000, direction: .received,
                          data: .text("{\"type\":\"data\",\"id\":\"1\",\"payload\":{\"data\":{\"users\":[]}}}"), size: 52),
                WsMessage(timestamp: now - 100, direction: .sent,
                          data: .byteCount(65_000), size: 65_000, binary: true),
            ],
            wsProtocol: "graphql-ws"
        )
    }()
}

#Preview("WsFrames") {
    ScrollView {
        WsFramesView(request: PreviewData.wsRequest)
            .padding(Theme.s16)
    }
    .background(Theme.bg)
}

#Preview("WsFrames — empty") {
    ScrollView {
        WsFramesView(request: NetworkRequest(
            url: "wss://api.example.com/socket",
            method: .get,
            startTime: Int64(Date().timeIntervalSince1970 * 1000),
            source: .nativeWebSocket
        ))
        .padding(Theme.s16)
    }
    .background(Theme.bg)
}
#endif

#endif // canImport(UIKit)
