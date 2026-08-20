import HakkaDesktopCore
import SwiftUI

struct RequestDocsTabView: View {
    @Binding var spec: RequestSpec

    var body: some View {
        TextEditor(text: notesBinding)
            .font(.body)
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(.separator))
    }

    private var notesBinding: Binding<String> {
        Binding(get: { spec.notes ?? "" }, set: { spec.notes = $0.isEmpty ? nil : $0 })
    }
}
