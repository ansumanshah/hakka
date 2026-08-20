import HakkaDesktopCore
import SwiftUI

struct RequestGraphQLBodyEditor: View {
    @Binding var spec: RequestSpec

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Query").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: queryBinding)
                .font(.system(.body, design: .monospaced))
                .frame(minHeight: 120)
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(.separator))
            Text("Variables (JSON)").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: variablesBinding)
                .font(.system(.body, design: .monospaced))
                .frame(minHeight: 80)
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(.separator))
        }
    }

    private var queryBinding: Binding<String> {
        Binding(
            get: { if case let .graphql(query, _) = spec.body { query } else { "" } },
            set: { newValue in
                guard case let .graphql(_, variables) = spec.body else { return }
                spec.body = .graphql(query: newValue, variables: variables)
            },
        )
    }

    private var variablesBinding: Binding<String> {
        Binding(
            get: { if case let .graphql(_, variables) = spec.body { variables } else { "" } },
            set: { newValue in
                guard case let .graphql(query, _) = spec.body else { return }
                spec.body = .graphql(query: query, variables: newValue)
            },
        )
    }
}
