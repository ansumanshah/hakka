import HakkaCore
import SwiftUI

struct RequestParamsTabView: View {
    @Binding var spec: RequestSpec

    var body: some View {
        ScrollView {
            HeaderPairListEditor(
                pairs: $spec.query,
                namePlaceholder: "Param",
                addTitle: "Add Param",
                emptyTitle: "No query parameters",
                emptyDescription: "Add a parameter to include it in the request URL.",
            )
        }
    }
}
