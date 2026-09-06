import SwiftUI

/// Compact inspector navigation shared by request and response panes.
struct InspectorTabStrip<Tab: Identifiable & Equatable>: View {
    @Binding var selection: Tab
    let tabs: [Tab]
    let title: (Tab) -> String

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.xs) {
                    ForEach(tabs) { tab in
                        Button {
                            selection = tab
                        } label: {
                            Text(title(tab))
                                .font(.caption.weight(selection == tab ? .semibold : .regular))
                                .foregroundStyle(selection == tab ? .primary : .secondary)
                                .fixedSize()
                                .padding(.horizontal, Spacing.md)
                                .frame(height: ControlHeight.md)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .overlay(alignment: .bottom) {
                            if selection == tab {
                                Rectangle()
                                    .fill(Color.accentColor)
                                    .frame(height: Spacing.xxs)
                            }
                        }
                        .accessibilityAddTraits(selection == tab ? .isSelected : [])
                        .id(tab.id)
                    }
                }
            }
            .onChange(of: selection) { _, tab in
                proxy.scrollTo(tab.id)
            }
        }
        .frame(height: ControlHeight.bar)
    }
}
