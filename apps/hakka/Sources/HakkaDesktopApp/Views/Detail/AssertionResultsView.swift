import HakkaDesktopCore
import SwiftUI

struct AssertionResultsView: View {
    let results: [AssertionResult]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Tests").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(results) { result in
                HStack(spacing: 6) {
                    Image(systemName: result.passed ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(result.passed ? .green : .red)
                    Text(describeTarget(result.target)).font(.caption)
                    Text(result.op.rawValue).font(.caption).foregroundStyle(.secondary)
                    Text(result.expected).font(.caption.weight(.medium))
                    if let actual = result.actual {
                        Text("(got \(actual))").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func describeTarget(_ target: AssertionTarget) -> String {
        switch target {
        case .status: "status"
        case .durationMs: "duration"
        case let .header(name): "header \(name)"
        case let .jsonPath(path): path
        case .bodyText: "body"
        }
    }
}
