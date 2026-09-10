import SwiftUI
import UniformTypeIdentifiers

/// Edits a user-selected local script and requires fresh authorization for every capture launch.
struct ProxyScriptEditor: View {
    @Binding var configuration: ProxyScriptConfiguration
    @State private var isChoosingFile = false
    @State private var errorMessage: String?

    var body: some View {
        Section("Request and response script") {
            Text("This runs local JavaScript against live proxy traffic. It can change request URLs, methods, headers, and text bodies, plus response status, headers, and text bodies.")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                Text(configuration.fileName)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Button("Choose JavaScript File…") { isChoosingFile = true }
            }

            if configuration.fileURL != nil {
                TextEditor(text: $configuration.source)
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 180)  // ui-token-check-ignore: script editor needs a useful code viewport
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(.separator))

                HStack {
                    Button("Save") { save() }
                    Spacer()
                    Text("Hooks run for at most 50 ms with a 16 MiB heap. Text bodies are limited to 1 MiB. A failed hook leaves that flow unchanged.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Toggle("Run this local script for the next capture", isOn: $configuration.isEnabledForNextLaunch)
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(ThemeTokens.Status.error)
            }
        }
        .fileImporter(isPresented: $isChoosingFile, allowedContentTypes: [.javaScript], allowsMultipleSelection: false) { result in
            do {
                guard let url = try result.get().first else { return }
                try configuration.load(from: url)
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func save() {
        do {
            try configuration.save()
            errorMessage = nil
        } catch {
            configuration.isEnabledForNextLaunch = false
            errorMessage = error.localizedDescription
        }
    }
}
