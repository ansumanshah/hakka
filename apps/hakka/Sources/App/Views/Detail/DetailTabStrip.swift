import SwiftUI

struct DetailTabStrip: View {
    @Binding var activeTab: DetailTab
    let tabs: [DetailTab]

    var body: some View {
        InspectorTabStrip(selection: $activeTab, tabs: tabs) { $0.rawValue }
    }
}
