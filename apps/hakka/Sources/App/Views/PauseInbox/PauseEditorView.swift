import HakkaCommon
import HakkaCore
import SwiftUI

/// The editable pause view. A request-phase pause exposes URL/method/
/// headers/body; a response-phase pause exposes status/headers/body — never
/// both on the same pause, since `PendingPause.phase` pins which one
/// `breakpoint.resume`'s `requestEdits`/`responseEdits` should carry.
struct PauseEditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let pause: PendingPause

    @State private var url: String
    @State private var method: String
    @State private var status: String
    @State private var headers: [PauseHeaderKV]
    @State private var bodyText: String

    init(pause: PendingPause) {
        self.pause = pause
        _url = State(initialValue: pause.request.url)
        _method = State(initialValue: pause.request.method)
        _status = State(initialValue: pause.response.map { String($0.status) } ?? "200")
        _headers = State(initialValue: Array(
            headers: pause.phase == .response ? (pause.response?.headers ?? [:]) : pause.request.headers
        ))
        _bodyText = State(initialValue: pause.phase == .response ? (pause.response?.body ?? "") : (pause.request.body ?? ""))
    }

    var body: some View {
        Form {
            if pause.phase == .response {
                Section("Response") {
                    LabeledField("Status", text: $status)
                    headerSection
                }
            } else {
                Section("Request") {
                    LabeledField("URL", text: $url)
                    LabeledField("Method", text: $method)
                    headerSection
                }
            }
            Section("Body") {
                TextEditor(text: $bodyText)
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 160)
            }
        }
        .formStyle(.grouped)
        .navigationTitle(pause.device)
        .toolbar {
            ToolbarItem(placement: .destructiveAction) {
                Button("Abort", role: .destructive) {
                    model.pauseInbox.abort(pause)
                    dismiss()
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Resume") {
                    resume()
                    dismiss()
                }
            }
        }
    }

    private var headerSection: some View {
        VStack(alignment: .leading) {
            Text("Headers").font(.caption).foregroundStyle(.secondary)
            PauseHeaderEditor(pairs: $headers)
        }
    }

    private func resume() {
        if pause.phase == .response {
            let edits = BreakpointResponseEdits(status: Int(status), headers: headers.asHeaders, body: bodyText)
            model.pauseInbox.resume(pause, responseEdits: edits)
        } else {
            let edits = BreakpointRequestEdits(url: url, method: method, headers: headers.asHeaders, body: bodyText)
            model.pauseInbox.resume(pause, requestEdits: edits)
        }
    }
}
