import HakkaDesktopCore
import SwiftUI

/// Assembles the request editor: method/URL bar, tab strip, and whichever
/// tab is active. Builds a non-optional `Binding<RequestSpec>` over the
/// model's optional `draft` once, so every child tab gets plain bindings
/// instead of re-deriving this each time.
struct RequestEditorContainerView: View {
    @Environment(AppModel.self) private var model
    @State private var activeTab: RequestTab = .params

    var body: some View {
        VStack(spacing: 0) {
            RequestMethodURLBar(spec: specBinding)
            Divider()
            RequestTabsView(activeTab: $activeTab)
            Divider()
            tabContent
                .padding(12)
        }
    }

    @ViewBuilder
    private var tabContent: some View {
        switch activeTab {
        case .params: RequestParamsTabView(spec: specBinding)
        case .headers: RequestHeadersTabView(spec: specBinding)
        case .body: RequestBodyTabView(spec: specBinding)
        case .auth: RequestAuthTabView(spec: specBinding)
        case .tests: RequestTestsTabView(spec: specBinding)
        case .docs: RequestDocsTabView(spec: specBinding)
        }
    }

    private var specBinding: Binding<RequestSpec> {
        Binding(
            get: { model.editor.draft ?? RequestSpec(name: "") },
            set: { model.editor.draft = $0 },
        )
    }
}
