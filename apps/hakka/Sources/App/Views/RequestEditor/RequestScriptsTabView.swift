import HakkaCore
import SwiftUI

/// Pre-request/post-response script authoring (ADR 0010 phase 4.4). Errors
/// surface inline, right under the editor they came from, rather than in a
/// separate console — `lastRunError` is a pre-request script's abort
/// reason (nothing else throws `RequestRunnerError.script` outside
/// `RequestScriptHooks`'s pre-request path, so any value here unambiguously
/// means the pre-request script failed), and `postResponseScriptError` is
/// `RunResult.scriptError`, a post-response script's failure against the
/// response that already came back.
struct RequestScriptsTabView: View {
    @Binding var spec: RequestSpec
    var lastRunError: String?
    var postResponseScriptError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                section(
                    title: "Pre-request",
                    subtitle: "Runs before the request is resolved and sent. Can mutate method, url, headers, and a raw text body. A throwing or timed-out script aborts the send.",
                    source: preRequestBinding,
                    error: lastRunError,
                )
                section(
                    title: "Post-response",
                    subtitle: "Runs after the response arrives. Can read env/response and hand a value to later requests with vars.set(name, value).",
                    source: postResponseBinding,
                    error: postResponseScriptError,
                )
            }
        }
    }

    @ViewBuilder
    private func section(title: String, subtitle: String, source: Binding<String>, error: String?) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(title).font(.headline)
            Text(subtitle).font(.caption).foregroundStyle(.secondary)
            TextEditor(text: source)
                .font(.system(.body, design: .monospaced))
                .frame(minHeight: 140)  // ui-token-check-ignore: body editor min height
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(.separator))
            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(ThemeTokens.Status.error)
            }
        }
    }

    // MARK: - Bindings

    /// Both bindings lazily create `spec.scripts` on first write and drop it
    /// back to `nil` once both hooks are empty again — a request with no
    /// scripting stays `scripts == nil` on disk (see `RequestScripts`),
    /// never an on-disk-but-empty placeholder.
    private var preRequestBinding: Binding<String> {
        Binding(
            get: { spec.scripts?.preRequestSource ?? "" },
            set: { newValue in
                var scripts = spec.scripts ?? RequestScripts()
                scripts.preRequestSource = newValue
                spec.scripts = scripts.isEmpty ? nil : scripts
            },
        )
    }

    private var postResponseBinding: Binding<String> {
        Binding(
            get: { spec.scripts?.postResponseSource ?? "" },
            set: { newValue in
                var scripts = spec.scripts ?? RequestScripts()
                scripts.postResponseSource = newValue
                spec.scripts = scripts.isEmpty ? nil : scripts
            },
        )
    }
}
