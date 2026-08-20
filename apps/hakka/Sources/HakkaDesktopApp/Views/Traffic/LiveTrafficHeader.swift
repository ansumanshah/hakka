import SwiftUI

/// Connection status + count + Clear — the traffic list's toolbar row.
struct LiveTrafficHeader: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack {
            Circle()
                .fill(model.traffic.isRunning ? Color.green : Color.red)
                .frame(width: 8, height: 8)
            Text(statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text("\(model.traffic.stats.count) requests")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("Clear") { Task { await model.traffic.clear() } }
                .font(.caption)
                .buttonStyle(.plain)
        }
        .padding(10)
    }

    private var statusText: String {
        if let error = model.traffic.lastError { return error }
        guard model.traffic.isRunning else { return "Starting…" }
        guard let port = model.traffic.boundPort else { return "Listening" }
        return "Listening on port \(port)"
    }
}
