import HakkaCore
import SwiftUI

/// Assertion authoring. Pass/fail *results* from the last run render in the
/// detail pane (`AssertionResultsView`), not here — this tab only edits what
/// will be checked next time.
struct RequestTestsTabView: View {
    @Binding var spec: RequestSpec

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                ForEach($spec.assertions) { $assertion in
                    AssertionRow(assertion: $assertion) {
                        spec.assertions.removeAll { $0.id == assertion.id }
                    }
                    Divider()
                }
                Button {
                    spec.assertions.append(Assertion(target: .status, op: .equals, expected: "200"))
                } label: {
                    Label("Add Assertion", systemImage: "plus")
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
        }
    }
}
