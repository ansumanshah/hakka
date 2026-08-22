import HakkaCore
import SwiftUI

/// Binary body editor: pick a file, send its bytes. `Content-Type` is
/// inferred from the extension the moment a file is chosen, then left as a
/// normal editable field — the inference is a starting point, not a lock.
struct RequestBinaryBodyEditor: View {
    @Binding var spec: RequestSpec

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            HStack(spacing: Spacing.md) {
                Image(systemName: "doc")
                    .foregroundStyle(.secondary)
                Text(fileName)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .foregroundStyle(path.isEmpty ? .tertiary : .primary)
                Spacer()
                Button("Choose…") { chooseFile() }
            }
            TextField("Content-Type", text: contentTypeBinding)
                .textFieldStyle(.roundedBorder)
        }
    }

    private var path: String {
        if case let .file(path, _) = spec.body { path } else { "" }
    }

    private var fileName: String {
        path.isEmpty ? "No file chosen" : (path as NSString).lastPathComponent
    }

    private func chooseFile() {
        guard let chosen = FilePicker.chooseFile(), case let .file(_, contentType) = spec.body else { return }
        // A generic content type (the empty-state default, or whatever the
        // previous file inferred) is replaced by the new file's own
        // inference; a content type the user already typed by hand is left
        // alone, same "explicit choice wins" rule as the Content-Type header.
        let inferred = ContentTypeInference.contentType(forPath: chosen)
        let nextContentType = contentType.isEmpty || contentType == "application/octet-stream" ? inferred : contentType
        spec.body = .file(path: chosen, contentType: nextContentType)
    }

    private var contentTypeBinding: Binding<String> {
        Binding(
            get: { if case let .file(_, contentType) = spec.body { contentType } else { "" } },
            set: { newValue in
                guard case let .file(path, _) = spec.body else { return }
                spec.body = .file(path: path, contentType: newValue)
            },
        )
    }
}
