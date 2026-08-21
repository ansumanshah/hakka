import HakkaCore
import SwiftUI

/// `multipart/form-data` editor: rows of name + value, where a value is
/// either inline text or a file reference. Actual encoding — boundary
/// choice, CRLF framing, `Content-Disposition` headers — lives entirely in
/// `RequestBodyEncoder`; this view only edits the `[MultipartPart]` model.
struct RequestMultipartBodyEditor: View {
    @Binding var spec: RequestSpec

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(partsBinding) { $part in
                MultipartPartRow(part: $part, onDelete: { removePart(id: part.id) })
                Divider()
            }
            Button {
                partsBinding.wrappedValue.append(MultipartPart(name: ""))
            } label: {
                Label("Add Part", systemImage: "plus")
            }
            .buttonStyle(.plain)
            .padding(.top, 8)
        }
    }

    private var partsBinding: Binding<[MultipartPart]> {
        Binding(
            get: { if case let .multipart(parts) = spec.body { parts } else { [] } },
            set: { spec.body = .multipart($0) },
        )
    }

    private func removePart(id: String) {
        partsBinding.wrappedValue.removeAll { $0.id == id }
    }
}
