import SwiftUI

/// Compact tabs for named investigation lenses over the shared traffic buffer.
/// They persist queries and selections, never captured records or their bodies.
struct TrafficSavedViewsStrip: View {
    let store: TrafficSavedViewStore
    @Binding var query: String
    @Binding var selectedRequestID: String?

    @State private var isPresentingRename = false
    @State private var draftName = ""
    @State private var viewBeingRenamed: TrafficSavedView?

    var body: some View {
        HStack(spacing: Spacing.xs) {
            ScrollView(.horizontal) {
                HStack(spacing: Spacing.xs) {
                    allTrafficTab
                    ForEach(store.views) { view in
                        savedViewTab(view)
                    }
                }
                .padding(.vertical, Spacing.xs)
            }
            .scrollIndicators(.hidden)

        }
        .font(.caption)
        .alert("Rename Traffic View", isPresented: $isPresentingRename) {
            TextField("Name", text: $draftName)
            Button("Rename") { renameView() }
            Button("Cancel", role: .cancel) { viewBeingRenamed = nil }
        }
        .onAppear(perform: restoreActiveView)
    }

    private var allTrafficTab: some View {
        Button("Traffic") {
            store.showAllTraffic(currentQuery: query, currentSelection: selectedRequestID)
            query = ""
            selectedRequestID = nil
        }
        .buttonStyle(.plain)
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(store.activeViewID == nil ? Color.accentColor.opacity(0.15) : .clear, in: RoundedRectangle(cornerRadius: Radius.sm))
        .accessibilityLabel("Show shared traffic view")
        .help("Return to the shared traffic view")
    }

    private func savedViewTab(_ view: TrafficSavedView) -> some View {
        HStack(spacing: 0) {
            Button(view.name) {
                let selected = store.activate(view, currentQuery: query, currentSelection: selectedRequestID)
                query = selected.query
                selectedRequestID = selected.selectedRequestID
            }
            .buttonStyle(.plain)
            .padding(.leading, Spacing.sm)
            .padding(.vertical, Spacing.xs)
            .accessibilityLabel("Show saved traffic view \(view.name)")
            .help("Show saved traffic view \(view.name)")

            Menu {
                Button("Rename \(view.name)") {
                    viewBeingRenamed = view
                    draftName = view.name
                    isPresentingRename = true
                }
                Button("Close \(view.name)", role: .destructive) {
                    closeView(view)
                }
            } label: {
                Image(systemName: "ellipsis")
            }
            .menuStyle(.borderlessButton)
            .accessibilityLabel("Actions for saved traffic view \(view.name)")
            .help("Actions for \(view.name)")

            if store.activeViewID == view.id {
                Button {
                    closeView(view)
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption2.weight(.bold))
                }
                .buttonStyle(.borderless)
                .padding(.trailing, Spacing.sm)
                .accessibilityLabel("Close saved traffic view \(view.name)")
                .help("Close \(view.name)")
            }
        }
        .background(store.activeViewID == view.id ? Color.accentColor.opacity(0.15) : .clear)
        .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
    }

    private func renameView() {
        guard let viewBeingRenamed else { return }
        _ = store.rename(viewBeingRenamed, to: draftName)
        self.viewBeingRenamed = nil
    }

    private func closeView(_ view: TrafficSavedView) {
        if store.close(view, currentQuery: query, currentSelection: selectedRequestID) {
            query = ""
            selectedRequestID = nil
        }
    }

    private func restoreActiveView() {
        guard let view = store.activeView else { return }
        query = view.query
        selectedRequestID = view.selectedRequestID
    }
}
