import HakkaCommon
import HakkaCore
import SwiftUI

/// The "+ Add rule" flow: author a mock or breakpoint from scratch, rather
/// than promoting one from a captured request. Mirrors `PauseEditorView`'s
/// shell (`NavigationStack` + `Form` + cancellation/confirmation toolbar
/// actions) — the house pattern for a single-record editor sheet.
///
/// Both kinds are cheap here because `RuleStore.add`/`RulesModel.createRule`
/// are payload-agnostic — they take whichever `RuleEntry.Payload` case is
/// built below and never know which sheet built it.
struct AddRuleSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var kind: RuleKind = .mock
    @State private var method = "Any"
    @State private var pattern = ""
    @State private var status = "200"
    @State private var contentType = "application/json"
    @State private var bodyText = ""
    @State private var phase: BreakpointPhase = .request
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private static let methodOptions = ["Any"] + HttpMethod.allCases.map(\.rawValue)

    var body: some View {
        NavigationStack {
            Form {
                Picker("Kind", selection: $kind) {
                    ForEach(RuleKind.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)

                Section("Match") {
                    Picker("Method", selection: $method) {
                        ForEach(Self.methodOptions, id: \.self) { Text($0).tag($0) }
                    }
                    LabeledField("URL pattern", text: $pattern)
                }

                if kind == .mock {
                    mockFields
                } else {
                    breakpointFields
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(ThemeTokens.Status.error)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Add Rule")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { create() }
                        .disabled(!canCreate)
                }
            }
        }
        .frame(width: 480, height: 520)  // ui-token-check-ignore: sheet size
    }

    private var mockFields: some View {
        Section("Response") {
            LabeledField("Status", text: $status)
            LabeledField("Content-Type", text: $contentType)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Body").font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $bodyText)
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 140)  // ui-token-check-ignore: body editor min height
            }
        }
    }

    private var breakpointFields: some View {
        Section("Pause") {
            Picker("Phase", selection: $phase) {
                Text("Request").tag(BreakpointPhase.request)
                Text("Response").tag(BreakpointPhase.response)
                Text("Request + Response").tag(BreakpointPhase.both)
            }
        }
    }

    private var canCreate: Bool {
        !pattern.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isSubmitting
            && (kind == .breakpoint || Int(status) != nil)
    }

    private func create() {
        errorMessage = nil
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                _ = try await model.rules.createRule(buildPayload())
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func buildPayload() throws -> RuleEntry.Payload {
        let trimmedPattern = pattern.trimmingCharacters(in: .whitespacesAndNewlines)
        let methodValue = method == "Any" ? nil : method
        switch kind {
        case .mock:
            guard let statusCode = Int(status) else { throw CreationError.invalidStatus }
            let trimmedType = contentType.trimmingCharacters(in: .whitespacesAndNewlines)
            let headers = trimmedType.isEmpty ? [:] : ["Content-Type": trimmedType]
            let response = MockResponse(status: statusCode, headers: headers, body: bodyText.isEmpty ? nil : bodyText)
            return .mock(MockRuleInput(pattern: trimmedPattern, method: methodValue, response: response))
        case .breakpoint:
            return .breakpoint(BreakpointInput(pattern: trimmedPattern, method: methodValue, on: phase))
        }
    }
}

private enum RuleKind: String, CaseIterable, Identifiable {
    case mock = "Mock"
    case breakpoint = "Breakpoint"
    var id: String { rawValue }
}

private enum CreationError: LocalizedError {
    case invalidStatus
    var errorDescription: String? { "Status must be a number." }
}
