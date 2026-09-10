import SwiftUI

/// Native section navigation keeps less frequent editors reachable at narrow widths.
struct RequestTabsView: View {
    @Binding var activeTab: RequestTab

    private let primaryTabs: [RequestTab] = [.params, .headers, .body, .auth]
    private let secondaryTabs: [RequestTab] = [.tests, .scripts, .session, .docs]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            sectionPicker(RequestTab.allCases)
                .fixedSize(horizontal: true, vertical: false)
            compactNavigation
                .fixedSize(horizontal: true, vertical: false)
            allSectionsMenu
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: ControlHeight.field)
        .padding(.horizontal, Layout.gutter)
        .controlSize(.small)
        .background(sectionShortcuts)
    }

    private func sectionPicker(_ tabs: [RequestTab]) -> some View {
        Picker("Request section", selection: $activeTab) {
            ForEach(tabs) { tab in
                Text(tab.rawValue).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
    }

    private var compactNavigation: some View {
        HStack(spacing: Spacing.sm) {
            sectionPicker(compactPickerTabs)
            Menu {
                ForEach(secondaryTabs) { tab in
                    sectionButton(tab)
                }
            } label: {
                Label(secondaryTabs.contains(activeTab) ? activeTab.rawValue : "More", systemImage: "ellipsis")
            }
            .help("Choose Tests, Scripts, Session, or Docs")
        }
    }

    /// Keep the active secondary section visible in the segmented control so
    /// the picker never highlights an unrelated primary section.
    private var compactPickerTabs: [RequestTab] {
        primaryTabs + (secondaryTabs.contains(activeTab) ? [activeTab] : [])
    }

    private var allSectionsMenu: some View {
        Menu {
            ForEach(RequestTab.allCases) { tab in
                sectionButton(tab)
            }
        } label: {
            Label(activeTab.rawValue, systemImage: "rectangle.3.group")
        }
        .help("Choose a request section")
    }

    private func sectionButton(_ tab: RequestTab) -> some View {
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

    private var sectionShortcuts: some View {
        ForEach(Array(RequestTab.allCases.enumerated()), id: \.element.id) { index, tab in
            Button("") { activeTab = tab }
                .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
                .hidden()
                .frame(width: 0, height: 0)
        }
    }
}
