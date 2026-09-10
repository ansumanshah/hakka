import HakkaCore
import SwiftUI

struct RequestHeadersTabView: View {
    @Binding var spec: RequestSpec

    var body: some View {
        ScrollView {
            HeaderPairListEditor(
                pairs: $spec.headers,
                namePlaceholder: "Header",
                addTitle: "Add Header",
                emptyTitle: "No request headers",
                emptyDescription: "Add a header to send it with this request.",
            )
        }
    }
}
