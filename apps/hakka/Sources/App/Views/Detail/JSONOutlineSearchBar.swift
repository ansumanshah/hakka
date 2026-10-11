import HakkaCore
import SwiftUI

/// Search controls for the JSON tree. The field selector makes it clear
/// whether an API response is being searched by property name, scalar value,
/// or its outline path.
struct JSONOutlineSearchBar: View {
    @Binding var searchText: String
    @Binding var scope: JSONOutlineSearch.Scope
    let result: JSONOutlineSearch.Result?

    var body: some View {
        HStack(spacing: Spacing.md) {
            Menu {
                Picker("JSON search field", selection: $scope) {
                    ForEach(JSONOutlineSearch.Scope.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
                .labelsHidden()
            } label: {
                Text(scope.rawValue)
                    .font(.callout)
            }
            .menuStyle(.borderlessButton)
            .controlSize(.regular)
            .padding(.horizontal, Spacing.md)
            .frame(width: 86, height: ControlHeight.icon) // ui-token-check-ignore: compact search scope width
            .background(ThemeTokens.Palette.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(ThemeTokens.Palette.border)
                    .allowsHitTesting(false)
            }
            .accessibilityLabel("JSON search field: \(scope.rawValue)")

            HStack(spacing: Spacing.sm) {
                Image(systemName: "magnifyingglass")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField(scope.placeholder, text: $searchText)
                    .textFieldStyle(.plain)
                    .font(.callout)
            }
            .padding(.horizontal, Spacing.md)
            .frame(minHeight: ControlHeight.icon)
            .background(ThemeTokens.Palette.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(ThemeTokens.Palette.border)
                    .allowsHitTesting(false)
            }
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
                .help("Clear JSON search")
                .accessibilityLabel("Clear JSON search")
            }
            if let result {
                Text(status(for: result))
                    .font(.callout.monospaced())
                    .foregroundStyle(result.isEmpty ? .secondary : .primary)
            }
        }
    }

    private func status(for result: JSONOutlineSearch.Result) -> String {
        let count = result.matches.count
        let suffix = result.isTruncated ? "+" : ""
        return count == 1 ? "1 result\(suffix)" : "\(count) results\(suffix)"
    }
}
