import HakkaCore
import SwiftUI

/// One row in the Tests tab: target kind (+ header name/JSON path when the
/// kind needs one), operator, expected value, enabled toggle, delete.
struct AssertionRow: View {
    @Binding var assertion: Assertion
    let onDelete: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Spacing.md) {
                enabledToggle
                targetPicker
                if kindBinding.wrappedValue.needsDetail {
                    detailField.fixedSize(horizontal: true, vertical: false)
                }
                operatorPicker
                expectedField.fixedSize(horizontal: true, vertical: false)
                deleteButton
            }
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(spacing: Spacing.md) {
                    enabledToggle
                    targetPicker
                    operatorPicker
                    Spacer(minLength: 0)
                    deleteButton
                }
                HStack(spacing: Spacing.md) {
                    if kindBinding.wrappedValue.needsDetail {
                        detailField
                    }
                    expectedField
                }
            }
        }
        .opacity(assertion.enabled ? 1 : 0.5)
    }

    private var enabledToggle: some View {
        Toggle("Enable assertion", isOn: $assertion.enabled)
            .labelsHidden()
            .toggleStyle(.checkbox)
    }

    private var targetPicker: some View {
        Picker("Assertion target", selection: kindBinding) {
            ForEach(AssertionTargetKind.allCases) { Text($0.rawValue).tag($0) }
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .fixedSize(horizontal: true, vertical: false)
    }

    private var operatorPicker: some View {
        Picker("Comparison", selection: $assertion.op) {
            ForEach(AssertionOperator.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .fixedSize(horizontal: true, vertical: false)
    }

    private var detailField: some View {
        TextField(kindBinding.wrappedValue == .header ? "Header name" : "$.path", text: detailBinding)
            .textFieldStyle(.roundedBorder)
            .accessibilityLabel(kindBinding.wrappedValue == .header ? "Header name" : "JSON path")
    }

    private var expectedField: some View {
        TextField("Expected", text: $assertion.expected)
            .textFieldStyle(.roundedBorder)
            .accessibilityLabel("Expected value")
    }

    private var deleteButton: some View {
        Button(action: onDelete) {
            Label("Delete assertion", systemImage: "minus.circle")
                .labelStyle(.iconOnly)
                .foregroundStyle(.secondary)
                .frame(width: ControlHeight.icon, height: ControlHeight.icon)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .help("Delete assertion")
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
