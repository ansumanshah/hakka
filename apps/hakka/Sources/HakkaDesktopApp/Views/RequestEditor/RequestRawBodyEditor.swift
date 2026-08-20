import HakkaDesktopCore
import SwiftUI

struct RequestRawBodyEditor: View {
    @Binding var spec: RequestSpec

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Content-Type", text: contentTypeBinding)
                .textFieldStyle(.roundedBorder)
            TextEditor(text: textBinding)
                .font(.system(.body, design: .monospaced))
                .frame(minHeight: 200)
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(.separator))
        }
    }

    private var contentTypeBinding: Binding<String> {
        Binding(
            get: { if case let .raw(_, contentType) = spec.body { contentType } else { "" } },
            set: { newValue in
                guard case let .raw(text, _) = spec.body else { return }
                spec.body = .raw(text: text, contentType: newValue)
            },
        )
    }

    private var textBinding: Binding<String> {
        Binding(
            get: { if case let .raw(text, _) = spec.body { text } else { "" } },
            set: { newValue in
                guard case let .raw(_, contentType) = spec.body else { return }
                spec.body = .raw(text: newValue, contentType: contentType)
            },
        )
    }
}
