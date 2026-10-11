import SwiftUI

/// Inline find bar for the body viewers: query field, n/m counter, and
/// previous/next stepping. Pure presentation — the model owns the match
/// list and active index.
struct BodySearchBar: View {
    @Binding var searchText: String
    let matchCount: Int
    let activeMatchIndex: Int
    let onPrevious: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "magnifyingglass")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("Search body", text: $searchText)
                .textFieldStyle(.roundedBorder)
                .font(.caption)
                .onSubmit(onNext)
            if !searchText.trimmingCharacters(in: .whitespaces).isEmpty {
                if matchCount > 0 {
                    Text("\(activeMatchIndex % matchCount + 1)/\(matchCount)")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                    Button(action: onPrevious) {
                        Label("Previous match", systemImage: "chevron.up")
                            .labelStyle(.iconOnly)
                            .frame(width: ControlHeight.icon, height: ControlHeight.icon)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.borderless)
                    .help("Previous match")
                    Button(action: onNext) {
                        Label("Next match", systemImage: "chevron.down")
                            .labelStyle(.iconOnly)
                            .frame(width: ControlHeight.icon, height: ControlHeight.icon)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.borderless)
                    .help("Next match")
                } else {
                    Text("No matches")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
    }
}
