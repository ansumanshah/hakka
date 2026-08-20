import HakkaCommon
import HakkaDesktopCore
import SwiftUI

/// Side-by-side comparison of two captured requests — "why did this response
/// change after my edit". Presented as a sheet from the traffic list.
struct RequestDiffView: View {
    let before: NetworkRequest
    let after: NetworkRequest
    let dismiss: () -> Void

    private var diff: RequestDiff { RequestDiff.diff(before, after) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    statusSection
                    headerSection("Request Headers", diff.requestHeaders)
                    headerSection("Response Headers", diff.responseHeaders)
                    bodySection("Request Body", diff.requestBody)
                    bodySection("Response Body", diff.responseBody)
                }
                .padding(16)
            }
        }
        .frame(minWidth: 640, minHeight: 460)
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Compare").font(.headline)
                Text(before.url)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            Button("Done", action: dismiss)
                .keyboardShortcut(.defaultAction)
        }
        .padding(12)
    }

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle("Status")
            if diff.status.changed {
                HStack(spacing: 8) {
                    Text(statusLabel(diff.status.before)).foregroundStyle(Color.red)
                    Image(systemName: "arrow.right").font(.caption).foregroundStyle(.secondary)
                    Text(statusLabel(diff.status.after)).foregroundStyle(Color.green)
                }
                .font(.callout.monospaced())
            } else {
                Text("Unchanged (\(statusLabel(diff.status.before)))")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func headerSection(_ title: String, _ headers: RequestDiff.HeaderDiff) -> some View {
        let hasChanges = !headers.added.isEmpty || !headers.removed.isEmpty || !headers.changed.isEmpty
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle(title)
            if hasChanges {
                ForEach(headers.removed, id: \.name) { change in
                    changeRow(sign: "−", text: "\(change.name): \(change.before.joined(separator: ", "))", tint: .red)
                }
                ForEach(headers.added, id: \.name) { change in
                    changeRow(sign: "+", text: "\(change.name): \(change.after.joined(separator: ", "))", tint: .green)
                }
                ForEach(headers.changed, id: \.name) { change in
                    changeRow(sign: "−", text: "\(change.name): \(change.before.joined(separator: ", "))", tint: .red)
                    changeRow(sign: "+", text: "\(change.name): \(change.after.joined(separator: ", "))", tint: .green)
                }
            } else {
                unchangedNote
            }
        }
    }

    @ViewBuilder
    private func bodySection(_ title: String, _ body: RequestDiff.BodyDiff) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle(title)
            switch body {
            case .notCaptured:
                // Deliberately not "unchanged": neither side captured a body,
                // so whether the bytes differ is unknowable from the capture.
                Text("Not captured on either side — binary or over the size cap, so there is nothing to compare.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            case let .availabilityChanged(hadBefore, hadAfter):
                Text(hadAfter ? "Captured only on the newer request." : "Captured only on the older request.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(hadBefore ? "Body present before, absent after" : "Body absent before, present after")
            case let .lines(entries):
                if entries.contains(where: isChange) {
                    ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                        lineRow(entry)
                    }
                } else {
                    unchangedNote
                }
            }
        }
    }

    @ViewBuilder
    private func lineRow(_ entry: LineDiffEntry) -> some View {
        switch entry {
        case let .added(text): changeRow(sign: "+", text: text, tint: .green)
        case let .removed(text): changeRow(sign: "−", text: text, tint: .red)
        case let .unchanged(text): changeRow(sign: " ", text: text, tint: .secondary)
        }
    }

    private func changeRow(sign: String, text: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(sign).font(.caption.monospaced()).foregroundStyle(tint)
            Text(text)
                .font(.caption.monospaced())
                .foregroundStyle(tint)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
    }

    private var unchangedNote: some View {
        Text("Unchanged").font(.caption).foregroundStyle(.secondary)
    }

    private func statusLabel(_ status: Int?) -> String {
        status.map(String.init) ?? "–"
    }

    private func isChange(_ entry: LineDiffEntry) -> Bool {
        if case .unchanged = entry { return false }
        return true
    }
}
