// @generated — do not edit. Synced from ios/Sources/UI/Breakpoints/BreakpointsPausedCards.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
#if canImport(HakkaCommon)
import HakkaCommon
#endif

// MARK: - PausedEntryCard
//
// See BreakpointsView.swift for the split's overview. Called from
// `pausedSection` in BreakpointsSections.swift.

/// A card for a single paused request or response.
@MainActor
struct PausedEntryCard: View {
    let entry: PausedEntry

    var body: some View {
        switch entry {
        case .request(let id, _, let req):
            PausedRequestCard(pauseId: id, request: req)
        case .response(let id, _, let res):
            PausedResponseCard(pauseId: id, response: res)
        }
    }
}

// MARK: - PausedRequestCard

@MainActor
private struct PausedRequestCard: View {
    let pauseId: String
    let request: PausedRequest

    @State private var editUrl: String
    @State private var editBody: String

    init(pauseId: String, request: PausedRequest) {
        self.pauseId = pauseId
        self.request = request
        self._editUrl = State(initialValue: request.url)
        self._editBody = State(initialValue: request.body ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            HStack(spacing: Theme.s8) {
                Text(request.method)
                    .font(.caption2.weight(.bold).monospaced())
                    .foregroundStyle(Theme.info)
                    .padding(.horizontal, Theme.s6)
                    .padding(.vertical, HakkaMetrics.Spacing.xxs)
                    .background(Theme.info.opacity(0.10))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusS).stroke(Theme.info.opacity(0.40), lineWidth: 1))

                TextField("URL", text: $editUrl)
                    .font(.caption.monospaced())
                    .foregroundStyle(Theme.text)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding(.horizontal, Theme.s8)
                    .padding(.vertical, Theme.s4)
                    .background(Theme.bg)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusS).stroke(Theme.border, lineWidth: 0.5))
                    .accessibilityLabel("Edit paused URL")
            }

            // Headers (read-only)
            if !request.headers.isEmpty {
                VStack(alignment: .leading, spacing: Theme.s4) {
                    sectionLabel("Headers (read-only)")
                    ScrollView {
                        VStack(alignment: .leading, spacing: HakkaMetrics.Spacing.xxs) {
                            ForEach(request.headers.sorted(by: { $0.key < $1.key }), id: \.key) { k, v in
                                HStack(spacing: Theme.s4) {
                                    Text("\(k):")
                                        .font(.system(size: HakkaMetrics.FontSize.xs, design: .monospaced))
                                        .foregroundStyle(Theme.textSecondary)
                                        .lineLimit(1)
                                    Text(v)
                                        .font(.system(size: HakkaMetrics.FontSize.xs, design: .monospaced))
                                        .foregroundStyle(Theme.text)
                                        .lineLimit(1)
                                }
                            }
                        }
                        .padding(Theme.s6)
                    }
                    .frame(maxHeight: 80)  // ui-token-check-ignore: multi-line editor bounds — content box, not a control
                    .background(Theme.bg)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusS).stroke(Theme.border, lineWidth: 0.5))
                }
            }

            VStack(alignment: .leading, spacing: Theme.s4) {
                sectionLabel("Body")
                TextEditor(text: $editBody)
                    .font(.system(size: HakkaMetrics.FontSize.sm, design: .monospaced))
                    .foregroundStyle(Theme.text)
                    .scrollContentBackground(.hidden)
                    .background(Theme.bg)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusS).stroke(Theme.border, lineWidth: 0.5))
                    .frame(minHeight: 60, maxHeight: 120)  // ui-token-check-ignore: multi-line editor bounds — content box, not a control
                    .accessibilityLabel("Edit paused body")
            }

            Text("Edits to URL and body are applied to the outgoing request on Resume.")
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
                .italic()

            cardActions
        }
        .padding(Theme.s12)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusM).stroke(Theme.warning, lineWidth: 1))
    }

    private var cardActions: some View {
        HStack(spacing: Theme.s8) {
            Spacer()
            Button {
                BreakpointEngine.shared.abort(pauseId: pauseId)
                Haptics.light()
            } label: {
                Text("Abort")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Theme.s12)
                    .padding(.vertical, Theme.s6)
                    .background(Theme.error)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Abort paused request")

            Button {
                let edits = PausedRequest(
                    url: editUrl,
                    method: request.method,
                    headers: request.headers,
                    body: editBody.isEmpty ? nil : editBody
                )
                BreakpointEngine.shared.resume(pauseId: pauseId, requestEdits: edits)
                Haptics.light()
            } label: {
                Text("Resume")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Theme.s12)
                    .padding(.vertical, Theme.s6)
                    .background(Theme.success)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Resume paused request")
        }
    }
}

// MARK: - PausedResponseCard

@MainActor
private struct PausedResponseCard: View {
    let pauseId: String
    let response: PausedResponse

    @State private var editStatus: String
    @State private var editHeadersText: String
    @State private var editBody: String

    init(pauseId: String, response: PausedResponse) {
        self.pauseId = pauseId
        self.response = response
        self._editStatus = State(initialValue: String(response.status))
        self._editHeadersText = State(initialValue: headersToText(response.headers))
        self._editBody = State(initialValue: response.body)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            HStack(spacing: Theme.s8) {
                Text("RES")
                    .font(.caption2.weight(.bold).monospaced())
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, Theme.s6)
                    .padding(.vertical, HakkaMetrics.Spacing.xxs)
                    .background(Theme.textTertiary.opacity(0.14))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusS).stroke(Theme.textTertiary.opacity(0.40), lineWidth: 1))

                TextField("200", text: $editStatus)
                    .keyboardType(.numberPad)
                    .font(.caption.monospaced())
                    .foregroundStyle(Theme.text)
                    .padding(.horizontal, Theme.s8)
                    .padding(.vertical, Theme.s4)
                    .background(Theme.bg)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusS).stroke(Theme.border, lineWidth: 0.5))
                    .accessibilityLabel("Edit paused status")
            }

            VStack(alignment: .leading, spacing: Theme.s4) {
                sectionLabel("Response headers")
                TextEditor(text: $editHeadersText)
                    .font(.system(size: HakkaMetrics.FontSize.sm, design: .monospaced))
                    .foregroundStyle(Theme.text)
                    .scrollContentBackground(.hidden)
                    .background(Theme.bg)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusS).stroke(Theme.border, lineWidth: 0.5))
                    .frame(minHeight: 50, maxHeight: 90)  // ui-token-check-ignore: multi-line editor bounds — content box, not a control
                    .accessibilityLabel("Edit paused response headers")
            }

            VStack(alignment: .leading, spacing: Theme.s4) {
                sectionLabel("Response body")
                TextEditor(text: $editBody)
                    .font(.system(size: HakkaMetrics.FontSize.sm, design: .monospaced))
                    .foregroundStyle(Theme.text)
                    .scrollContentBackground(.hidden)
                    .background(Theme.bg)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusS).stroke(Theme.border, lineWidth: 0.5))
                    .frame(minHeight: 60, maxHeight: 120)  // ui-token-check-ignore: multi-line editor bounds — content box, not a control
                    .accessibilityLabel("Edit paused response body")
            }

            Text("Edits to status, headers, and body are applied to the response the caller receives on Resume.")
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
                .italic()

            cardActions
        }
        .padding(Theme.s12)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusM).stroke(Theme.warning, lineWidth: 1))
    }

    private var cardActions: some View {
        HStack(spacing: Theme.s8) {
            Spacer()
            Button {
                BreakpointEngine.shared.abort(pauseId: pauseId)
                Haptics.light()
            } label: {
                Text("Abort")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Theme.s12)
                    .padding(.vertical, Theme.s6)
                    .background(Theme.error)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Abort paused response")

            Button {
                let edits = PausedResponse(
                    status: Int(editStatus) ?? response.status,
                    headers: textToHeaders(editHeadersText),
                    body: editBody
                )
                BreakpointEngine.shared.resumeResponse(pauseId: pauseId, responseEdits: edits)
                Haptics.light()
            } label: {
                Text("Resume")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Theme.s12)
                    .padding(.vertical, Theme.s6)
                    .background(Theme.success)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Resume paused response")
        }
    }
}

// MARK: - View helpers

private func sectionLabel(_ label: String) -> some View {
    Text(label.uppercased())
        .font(.system(size: HakkaMetrics.FontSize.xs, weight: .bold))
        .foregroundStyle(Theme.textTertiary)
        .kerning(0.5)
}

// MARK: - Header text helpers (shared between cards)

private func headersToText(_ h: [String: String]) -> String {
    h.sorted(by: { $0.key < $1.key })
        .map { "\($0.key): \($0.value)" }
        .joined(separator: "\n")
}

private func textToHeaders(_ t: String) -> [String: String] {
    var out: [String: String] = [:]
    for line in t.split(separator: "\n", omittingEmptySubsequences: true) {
        let s = String(line)
        guard let i = s.firstIndex(of: ":") else { continue }
        let k = String(s[s.startIndex..<i]).trimmingCharacters(in: .whitespaces)
        guard !k.isEmpty else { continue }
        let v = String(s[s.index(after: i)...]).trimmingCharacters(in: .whitespaces)
        out[k] = v
    }
    return out
}
#endif // canImport(UIKit)
