import HakkaCore
import SwiftUI

/// One multipart part: a name, a value that's either inline text or a file
/// reference (never both — `MultipartPart.filePath` is what decides which),
/// an optional per-part `Content-Type`, and the same enable/delete chrome as
/// every other list row in this app.
struct MultipartPartRow: View {
    @Binding var part: MultipartPart
    let onDelete: () -> Void

    private var isFile: Bool { part.filePath != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.md) {
                Toggle(isOn: $part.enabled) { EmptyView() }
                    .labelsHidden()
                    .toggleStyle(.checkbox)
                TextField("Name", text: $part.name)
                    .textFieldStyle(.plain)
                    .frame(maxWidth: .infinity)
                Picker("", selection: kindBinding) {
                    Text("Text").tag(false)
                    Text("File").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 120)
                Button(action: onDelete) {
                    Image(systemName: "minus.circle")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            if isFile {
                fileValueRow
            } else {
                TextField("Value", text: valueBinding)
                    .textFieldStyle(.plain)
            }
            TextField("Content-Type (optional)", text: contentTypeBinding)
                .textFieldStyle(.plain)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .opacity(part.enabled ? 1 : 0.5)
        .padding(.vertical, Spacing.xs)
    }

    private var fileValueRow: some View {
        HStack(spacing: Spacing.md) {
            Text(part.filePath.map { ($0 as NSString).lastPathComponent } ?? "No file chosen")
                .font(.callout)
                .foregroundStyle(part.filePath == nil ? .tertiary : .primary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
            Button("Choose…") { chooseFile() }
        }
    }

    private func chooseFile() {
        guard let path = FilePicker.chooseFile() else { return }
        part.filePath = path
        if part.contentType == nil || part.contentType?.isEmpty == true {
            part.contentType = ContentTypeInference.contentType(forPath: path)
        }
    }

    private var kindBinding: Binding<Bool> {
        Binding(
            get: { isFile },
            set: { makeFile in
                if makeFile {
                    part.value = ""
                    part.filePath = ""
                } else {
                    part.filePath = nil
                }
            },
        )
    }

    private var valueBinding: Binding<String> {
        Binding(get: { part.value }, set: { part.value = $0 })
    }

    private var contentTypeBinding: Binding<String> {
        Binding(get: { part.contentType ?? "" }, set: { part.contentType = $0.isEmpty ? nil : $0 })
    }
}
