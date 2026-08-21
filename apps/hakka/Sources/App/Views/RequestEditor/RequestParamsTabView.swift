import HakkaCore
import SwiftUI

struct RequestParamsTabView: View {
    @Binding var spec: RequestSpec

    var body: some View {
        ScrollView {
            HeaderPairListEditor(pairs: $spec.query, namePlaceholder: "Param", addTitle: "Add Param")
        }
    }
}
