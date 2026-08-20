import HakkaDesktopCore
import SwiftUI

struct RequestHeadersTabView: View {
    @Binding var spec: RequestSpec

    var body: some View {
        ScrollView {
            HeaderPairListEditor(pairs: $spec.headers, namePlaceholder: "Header", addTitle: "Add Header")
        }
    }
}
