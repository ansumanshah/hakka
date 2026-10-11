import HakkaCore
import SwiftUI

/// Assembles the request editor: method/URL bar, tab strip, and whichever
/// tab is active. Builds a non-optional `Binding<RequestSpec>` over the
/// model's optional `draft` once, so every child tab gets plain bindings
/// instead of re-deriving this each time.
struct RequestEditorContainerView: View {
    @Environment(AppModel.self) private var model
    @SceneStorage("hakka.requestEditor.section") private var activeTabRaw = RequestTab.params.rawValue

    var body: some View {
        VStack(spacing: 0) {
            RequestWorkspaceTabsView()
            Divider()
            RequestMethodURLBar(spec: specBinding)
            Divider()
            RequestTabsView(activeTab: activeTabBinding)
            Divider()
            if activeTab == .auth || activeTab == .body {
                ScrollView {
                    paddedTabContent
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            } else {
                paddedTabContent
            }
        }
    }

    private var activeTab: RequestTab {
        RequestTab(rawValue: activeTabRaw) ?? .params
    }

    private var activeTabBinding: Binding<RequestTab> {
        Binding(get: { activeTab }, set: { activeTabRaw = $0.rawValue })
    }

    private var paddedTabContent: some View {
        tabContent
            .padding(.horizontal, Layout.gutter)
            .padding(.vertical, Spacing.sm)
    }

    @ViewBuilder
    private var tabContent: some View {
        switch activeTab {
        case .params: RequestParamsTabView(spec: specBinding)
        case .headers: RequestHeadersTabView(spec: specBinding)
        case .body: RequestBodyTabView(spec: specBinding)
        case .auth: RequestAuthTabView(spec: specBinding)
        case .tests: RequestTestsTabView(spec: specBinding)
        case .scripts: RequestScriptsTabView(
                spec: specBinding,
                lastRunError: model.editor.lastRunError,
                postResponseScriptError: model.editor.lastResult?.scriptError,
            )
        case .session: RequestSessionTabView(spec: specBinding)
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
