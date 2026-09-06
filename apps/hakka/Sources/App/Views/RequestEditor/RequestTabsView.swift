import SwiftUI

struct RequestTabsView: View {
    @Binding var activeTab: RequestTab

    var body: some View {
        InspectorTabStrip(selection: $activeTab, tabs: RequestTab.allCases) { $0.rawValue }
            .padding(.horizontal, Layout.gutter)
    }
}
