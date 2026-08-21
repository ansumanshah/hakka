import SwiftUI

/// Tab strip for the request editor.
struct RequestTabsView: View {
    @Binding var activeTab: RequestTab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(RequestTab.allCases) { tab in
                Button {
                    activeTab = tab
                } label: {
                    Text(tab.rawValue)
                        .font(.subheadline.weight(activeTab == tab ? .semibold : .regular))
                        .foregroundStyle(activeTab == tab ? .primary : .secondary)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 12)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .background(.bar)
    }
}
