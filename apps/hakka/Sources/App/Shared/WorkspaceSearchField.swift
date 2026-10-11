import SwiftUI

/// Search chrome shared by live traffic, structured logs, and storage.
struct WorkspaceSearchField: View {
    let prompt: String
    let accessibilityName: String
    @Binding var text: String
    var focusToken = 0
    var helpText: String = ""
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField(prompt, text: $text)
                .textFieldStyle(.plain)
                .focused($isFocused)
                .accessibilityLabel(accessibilityName)
                .help(helpText)
            if !text.isEmpty {
                Button {
                    text = ""
                    isFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .frame(width: ControlHeight.chip, height: ControlHeight.chip)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Clear \(accessibilityName.lowercased())")
            }
        }
        .font(.callout)
        .padding(.horizontal, Spacing.md)
        .frame(minHeight: ControlHeight.field)
        .background(ThemeTokens.Palette.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(isFocused ? ThemeTokens.Palette.textSecondary : ThemeTokens.Palette.border, lineWidth: isFocused ? Spacing.xxs : 1)
        }
        .onChange(of: focusToken) { _, _ in isFocused = true }
    }
}
