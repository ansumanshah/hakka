import HakkaCommon
import HakkaCore
import SwiftUI

/// gRPC / gRPC-Web body viewer: the resolved status prominently — the real
/// outcome of a gRPC call lives in the `grpc-status`/`grpc-message`
/// trailers, not the HTTP status; a failed gRPC call is usually HTTP 200 —
/// then the message frames. Every field value is schema-less inference from
/// raw wire bytes, never a decode against a `.proto`, so the notice below
/// the status banner stays visible the whole time this viewer is on screen.
struct GrpcBodyView: View {
    let decoded: GrpcDecodedBody

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            statusBanner
            inferredNotice
            frameList
        }
    }

    @ViewBuilder
    private var statusBanner: some View {
        if let status = decoded.status {
            let isOK = status.known?.isOK == true
            HStack(spacing: 6) {
                Image(systemName: isOK ? "checkmark.circle.fill" : "xmark.octagon.fill")
                    .foregroundStyle(isOK ? ThemeTokens.Status.success : ThemeTokens.Status.error)
                Text(status.known?.name ?? "CODE \(status.code)")
                    .font(.caption.weight(.semibold))
                if let message = status.message {
                    Text(message).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text(sourceLabel(status.source))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(8)
            .background((isOK ? ThemeTokens.Status.success : ThemeTokens.Status.error).opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 4))
        } else {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "questionmark.circle")
                    .foregroundStyle(ThemeTokens.Status.pending)
                Text(noStatusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(8)
            .background(ThemeTokens.Status.pending.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 4))
        }
    }

    private var noStatusMessage: String {
        decoded.isGrpcWeb
            ? "No trailer frame captured — the call may still be open, or the response was truncated before the trailer arrived."
            : "gRPC status not captured. Real gRPC trailers arrive as HTTP/2 trailer headers after the response body, and this capture pipeline does not currently retain trailer headers — the HTTP status shown elsewhere is not the gRPC outcome."
    }

    private func sourceLabel(_ source: GrpcStatusSource) -> String {
        switch source {
        case .grpcWebTrailerFrame: "from gRPC-Web trailer frame"
        case .trailersOnlyResponseHeader: "from response header (Trailers-Only)"
        }
    }

    private var inferredNotice: some View {
        Text("Fields below are inferred from raw wire bytes (field number + wire type), not decoded against a .proto schema — a guessed \"string\" may actually be bytes.")
            .font(.caption2)
            .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private var frameList: some View {
        if decoded.frames.isEmpty {
            Text("No message frames captured")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color.secondary.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 4))
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(decoded.frames.count) message frame\(decoded.frames.count == 1 ? "" : "s") — wire order; per-frame arrival time isn't captured (unlike WebSocket frames, gRPC frames carry no timestamp in `NetworkRequest`).")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        ForEach(decoded.frames) { frame in
                            GrpcFrameRowView(frame: frame)
                        }
                    }
                }
                .frame(maxHeight: 420)
            }
        }
    }
}
