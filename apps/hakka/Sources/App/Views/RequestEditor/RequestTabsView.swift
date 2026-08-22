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
                        .padding(.vertical, Spacing.md)
                        .padding(.horizontal, Spacing.lg)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .background(.bar)
    }
}
