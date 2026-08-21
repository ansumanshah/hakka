import HakkaCore
import SwiftUI

/// Binary body rendering: a byte-limited offset/hex/ASCII dump with the
/// not-shown footnote. Pure dump formatting lives in `HexDumper`.
struct HexBodyView: View {
    let bytes: [UInt8]

    var body: some View {
        ScrollView {
            Text(HexDumper.dump(bytes))
                .font(.system(.caption2, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 460)
        .padding(8)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}
