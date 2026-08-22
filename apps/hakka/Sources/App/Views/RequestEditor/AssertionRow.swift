import HakkaCore
import SwiftUI

/// One row in the Tests tab: target kind (+ header name/JSON path when the
/// kind needs one), operator, expected value, enabled toggle, delete.
struct AssertionRow: View {
    @Binding var assertion: Assertion
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: Spacing.md) {
            Toggle(isOn: $assertion.enabled) { EmptyView() }
                .labelsHidden()
                .toggleStyle(.checkbox)
            Picker("", selection: kindBinding) {
                ForEach(AssertionTargetKind.allCases) { Text($0.rawValue).tag($0) }
            }
            .labelsHidden()
            .frame(width: 110)
            if kindBinding.wrappedValue.needsDetail {
                TextField(kindBinding.wrappedValue == .header ? "Header name" : "$.path", text: detailBinding)
                    .textFieldStyle(.roundedBorder)
            }
            Picker("", selection: $assertion.op) {
                ForEach(AssertionOperator.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .labelsHidden()
            .frame(width: 120)
            TextField("Expected", text: $assertion.expected)
                .textFieldStyle(.roundedBorder)
            Button(action: onDelete) {
                Image(systemName: "minus.circle").foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .opacity(assertion.enabled ? 1 : 0.5)
    }

    private var kindBinding: Binding<AssertionTargetKind> {
        Binding(
            get: { AssertionTargetKind(assertion.target) },
            set: { assertion.target = $0.makeTarget(detail: detailBinding.wrappedValue) },
        )
    }

    private var detailBinding: Binding<String> {
        Binding(
            get: {
                switch assertion.target {
                case let .header(name): name
                case let .jsonPath(path): path
                default: ""
                }
            },
            set: { newValue in
                switch assertion.target {
                case .header: assertion.target = .header(name: newValue)
                case .jsonPath: assertion.target = .jsonPath(newValue)
                default: break
                }
            },
        )
    }
}
