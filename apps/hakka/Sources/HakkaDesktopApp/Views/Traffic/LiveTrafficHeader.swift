import SwiftUI

/// Connection status + count + Clear, over a search field — the traffic
/// list's toolbar.
struct LiveTrafficHeader: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Circle()
                    .fill(model.traffic.isRunning ? Color.green : Color.red)
                    .frame(width: 8, height: 8)
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(countText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Clear") { Task { await model.traffic.clear() } }
                    .font(.caption)
                    .buttonStyle(.plain)
            }
            searchField
        }
        .padding(10)
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("Search — try 2xx, method:POST, dur>100", text: searchBinding)
                .textFieldStyle(.plain)
                .font(.caption)
            if !model.traffic.searchText.isEmpty {
                Button {
                    model.traffic.searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
    }

    private var searchBinding: Binding<String> {
        Binding(get: { model.traffic.searchText }, set: { model.traffic.searchText = $0 })
    }

    /// Shows the filtered count alongside the total, so a search that hides
    /// everything doesn't read as "nothing was captured".
    private var countText: String {
        let total = model.traffic.stats.count
        let visible = model.traffic.visibleRequests.count
        return visible == total ? "\(total) requests" : "\(visible) of \(total)"
    }

    private var statusText: String {
        // A file-operation message is transient and takes the foreground, but a
        // dead bridge is permanent, so it wins once the transient one clears.
        if let error = model.traffic.lastError { return error }
        if let error = model.traffic.startupError { return error }
        guard model.traffic.isRunning else { return "Starting…" }
        guard let port = model.traffic.boundPort else { return "Listening" }
        return "Listening on port \(port)"
    }
}
