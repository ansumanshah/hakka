import SwiftUI

/// One editable header row for a pause edit. Deliberately not `HeaderPair`
/// (`HakkaCore`): the wire's `requestEdits`/`responseEdits` carry headers as
/// a plain `[String: String]` with no per-header enable flag, so round
/// tripping through the request editor's richer model would invent state
/// the wire has no way to send back.
struct PauseHeaderKV: Identifiable, Equatable {
    let id = UUID()
    var name: String
    var value: String
}

extension Array where Element == PauseHeaderKV {
    /// Sorted by key for a stable, readable editing order — the wire itself
    /// is an unordered dictionary.
    init(headers: [String: String]) {
        self = headers.sorted { $0.key < $1.key }.map { PauseHeaderKV(name: $0.key, value: $0.value) }
    }

    /// Blank-named rows are dropped rather than sent as an empty-string
    /// header key, which no server would accept either.
    var asHeaders: [String: String] {
        Dictionary(uniqueKeysWithValues: compactMap { $0.name.isEmpty ? nil : ($0.name, $0.value) })
    }
}

/// Minimal add/remove header list for the pause editor — simpler than
/// `HeaderPairListEditor` on purpose: a pause edit either includes a header
/// or it doesn't, with no per-row enable toggle to carry.
struct PauseHeaderEditor: View {
    @Binding var pairs: [PauseHeaderKV]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach($pairs) { $pair in
                HStack(spacing: 8) {
                    TextField("Key", text: $pair.name).textFieldStyle(.roundedBorder)
                    TextField("Value", text: $pair.value).textFieldStyle(.roundedBorder)
                    Button {
                        pairs.removeAll { $0.id == pair.id }
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
            }
            Button {
                pairs.append(PauseHeaderKV(name: "", value: ""))
            } label: {
                Label("Add Header", systemImage: "plus")
            }
            .buttonStyle(.plain)
        }
    }
}
