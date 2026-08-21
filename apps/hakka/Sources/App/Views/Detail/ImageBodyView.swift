import HakkaCore
import SwiftUI

/// Image body rendering: the captured body's recovered bytes through the
/// platform image view, with the content type and size beside it. Bodies
/// whose bytes decode to no image fall back to a labeled summary.
struct ImageBodyView: View {
    let bytes: [UInt8]
    let contentType: String?
    let byteCount: Int64

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "photo")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(contentType ?? "image")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                Text("(\(Fmt.bytes(byteCount)))")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            if let image = NSImage(data: Data(bytes)) {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: 400, maxHeight: 400)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            } else {
                Text("The captured image bytes could not be decoded.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
