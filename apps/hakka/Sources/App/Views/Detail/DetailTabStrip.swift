import SwiftUI

struct DetailTabStrip: View {
    @Binding var activeTab: DetailTab
    let tabs: [DetailTab]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            tabPicker(tabs)
                .fixedSize(horizontal: true, vertical: false)
            compactNavigation
                .fixedSize(horizontal: true, vertical: false)
            allTabsMenu
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: ControlHeight.field)
        .controlSize(.small)
    }

    private var primaryTabs: [DetailTab] {
        tabs.filter { [.overview, .request, .response, .timing].contains($0) }
    }

    private var secondaryTabs: [DetailTab] {
        tabs.filter { !primaryTabs.contains($0) }
    }

    private var compactPickerTabs: [DetailTab] {
        primaryTabs + (secondaryTabs.contains(activeTab) ? [activeTab] : [])
    }

    private var compactNavigation: some View {
        HStack(spacing: Spacing.sm) {
            tabPicker(compactPickerTabs)
            if !secondaryTabs.isEmpty {
                Menu {
                    ForEach(secondaryTabs) { tab in
                        tabButton(tab)
                    }
                } label: {
                    Label(secondaryTabs.contains(activeTab) ? activeTab.rawValue : "More", systemImage: "ellipsis")
                }
                .help("Choose a protocol detail")
            }
        }
    }

    private func tabPicker(_ visibleTabs: [DetailTab]) -> some View {
        Picker("Request detail", selection: $activeTab) {
            ForEach(visibleTabs) { tab in
                Text(tab.rawValue).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
    }

    private var allTabsMenu: some View {
        Menu {
            ForEach(tabs) { tab in
                tabButton(tab)
            }
        } label: {
            Label(activeTab.rawValue, systemImage: "rectangle.3.group")
        }
        .help("Choose request detail")
    }

    private func tabButton(_ tab: DetailTab) -> some View {
        Button {
            activeTab = tab
        } label: {
            if activeTab == tab {
                Label(tab.rawValue, systemImage: "checkmark")
            } else {
                Text(tab.rawValue)
            }
        }
    }
}
