import HakkaCore
import SwiftUI

/// Open request documents share one strip; editor sections stay below the URL.
struct RequestWorkspaceTabsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: Spacing.sm) {
            ScrollViewReader { scroll in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Spacing.xs) {
                        ForEach(model.requestWorkspaceTabs.openRequestIDs, id: \.self) { requestID in
                            if let request = model.collection.request(id: requestID) {
                                tab(for: request).id(requestID)
                            }
                        }
                    }
                }
                .accessibilityLabel("Open requests")
                .onChange(of: model.requestWorkspaceTabs.selectedRequestID) { _, id in
                    if let id { scroll.scrollTo(id) }
                }
            }
            Button(action: model.newRequest) {
                Image(systemName: "plus")
            }
            .help("New request (⌘N)")
            .accessibilityLabel("New request")
            Button("Save") { Task { await model.saveActiveRequest() } }
                .disabled(model.editor.draft == nil || (!model.editor.isDirty && model.collection.directoryURL != nil))
                .help("Save request (⌘S)")
                .accessibilityLabel("Save request")
        }
        .controlSize(.small)
        .padding(.horizontal, Layout.gutter)
        .frame(height: ControlHeight.bar)
    }

    private func tab(for request: RequestSpec) -> some View {
        let selected = model.requestWorkspaceTabs.selectedRequestID == request.id
        let dirty = model.editor.isDirty(requestID: request.id)
        return HStack(spacing: Spacing.sm) {
            Button {
                model.select(.request(id: request.id))
            } label: {
                HStack(spacing: Spacing.sm) {
                    Text(request.method.rawValue)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Fmt.methodColor(request.method))
                    Text(request.name).lineLimit(1)
                    if dirty {
                        Image(systemName: "circle.fill")
                            .font(.system(size: Spacing.xs))
                            .accessibilityLabel("Unsaved changes")
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected ? .isSelected : [])
            Button {
                model.closeRequestTab(id: request.id)
            } label: {
                Image(systemName: "xmark").font(.caption2)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close \(request.name)")
            .help(dirty ? "Close tab; unsaved edits remain available when reopened" : "Close tab")
        }
        .font(.caption.weight(selected ? .semibold : .regular))
        .foregroundStyle(selected ? .primary : .secondary)
        .padding(.horizontal, Spacing.md)
        .frame(height: ControlHeight.md)
        .background(selected ? Color(nsColor: .controlBackgroundColor) : .clear,
                    in: RoundedRectangle(cornerRadius: Radius.sm))
    }
}
