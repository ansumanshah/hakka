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
            Picker("JSON search field", selection: $scope) {
                ForEach(JSONOutlineSearch.Scope.allCases) { scope in
                    Text(scope.rawValue).tag(scope)
                }
            }
            .labelsHidden()
            .controlSize(.small)
            .frame(width: 92)

            Image(systemName: "magnifyingglass")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField(scope.placeholder, text: $searchText)
                .textFieldStyle(.roundedBorder)
                .font(.caption.monospaced())
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
                    .font(.caption.monospaced())
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
