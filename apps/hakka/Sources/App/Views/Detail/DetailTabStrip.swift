import SwiftUI

/// Tab strip for the request detail pane: mono, uppercase, letterspaced,
/// flame underline on the active tab.
struct DetailTabStrip: View {
    @Binding var activeTab: DetailTab
    let tabs: [DetailTab]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(tabs) { tab in
                Button {
                    activeTab = tab
                } label: {
                    VStack(spacing: Spacing.sm) {
                        Text(tab.rawValue.uppercased())
                            .font(.caption.monospaced().weight(isActive(tab) ? .semibold : .regular))
                            .tracking(0.8)
                            .foregroundStyle(isActive(tab) ? .primary : .secondary)
                            .padding(.top, Spacing.md)
                        Rectangle()
                            .fill(isActive(tab) ? Color.orange : Color.clear)
                            .frame(height: 2)  // ui-token-check-ignore: tab active indicator
                    }
                    .padding(.horizontal, Spacing.lg)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .background(.bar)
    }

    private func isActive(_ tab: DetailTab) -> Bool {
        activeTab == tab
    }
}
