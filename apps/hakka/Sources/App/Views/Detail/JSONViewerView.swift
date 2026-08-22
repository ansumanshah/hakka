import SwiftUI

/// JSON body rendering with a Pretty / Tree / Raw mode picker. Pretty and
/// Raw share `BodyTextView` (cap, search, load-full); Tree renders the lazy
/// outline. When the body failed to parse the tree tab explains itself and
/// the other modes keep working.
struct JSONViewerView: View {
    @Bindable var model: BodyViewerModel

    private let modes: [BodyViewerModel.DisplayMode] = [.pretty, .tree, .raw]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Picker("Display Mode", selection: $model.mode) {
                ForEach(modes) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 220)

            switch model.mode {
            case .pretty, .raw:
                BodyTextView(model: model)
            case .tree:
                treeContent
            }
        }
    }

    @ViewBuilder
    private var treeContent: some View {
        if let root = model.jsonOutlineRoot {
            ScrollView {
                JSONOutlineRowView(node: root, depth: 0)
                    .padding(Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 460)  // ui-token-check-ignore: pane cap
            .background(Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 4))
        } else {
            Text("This body did not parse as JSON.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.secondary.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 4))
        }
    }
}
