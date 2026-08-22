import HakkaCommon
import HakkaCore
import SwiftUI

/// One decoded gRPC message frame: index, byte length, compressed flag, and
/// its best-effort protobuf field tree (or the honest "not decoded"
/// placeholder for a per-message-compressed or `+json`-codec frame).
struct GrpcFrameRowView: View {
    let frame: GrpcRenderFrame

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                Text("frame \(frame.id)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                Text("\(frame.byteLength) bytes")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                if frame.compressed {
                    Label("compressed", systemImage: "bolt.fill")
                        .font(.caption2)
                        .foregroundStyle(ThemeTokens.Status.warning)
                }
            }
            payloadView
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    @ViewBuilder
    private var payloadView: some View {
        switch frame.payload {
        case .compressedNotInflated:
            Text("Per-message gzip compression set; Hakka does not inflate it, so raw field bytes would be garbage and are not shown.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        case .json(let text):
            Text(text)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
        case .fields(let fields):
            if fields.isEmpty {
                Text("No decodable fields (empty message, or bytes did not parse as protobuf)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    ForEach(Array(fields.enumerated()), id: \.offset) { _, field in
                        GrpcFieldRowView(field: field, depth: 0)
                    }
                }
            }
        }
    }
}

/// One protobuf field, recursively — nested sub-messages indent one level.
/// Every row leads with the inferred wire-type tag so a string/bytes guess
/// never reads as schema-confirmed.
struct GrpcFieldRowView: View {
    let field: ProtoField
    let depth: Int

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            HStack(alignment: .top, spacing: Spacing.xs) {
                Text(String(repeating: "  ", count: depth) + "#\(field.field)")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                Text(kindLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(valueText)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
            }
            if case .message(let sub) = field.value {
                ForEach(Array(sub.enumerated()), id: \.offset) { _, child in
                    GrpcFieldRowView(field: child, depth: depth + 1)
                }
            }
        }
    }

    private var kindLabel: String {
        switch field.value {
        case .varint: "varint · inferred"
        case .fixed64: "fixed64 · inferred"
        case .fixed32: "fixed32 · inferred"
        case .message: "message · inferred"
        case .string: "string? · inferred"
        case .bytes: "bytes"
        }
    }

    private var valueText: String {
        switch field.value {
        case .varint(let value): "\(value)"
        case .fixed64(let bits, let double): "\(bits) (as double: \(double))"
        case .fixed32(let bits, let float): "\(bits) (as float: \(float))"
        case .message: ""
        case .string(let string): "\"\(string)\""
        case .bytes(let hex): hex
        }
    }
}
