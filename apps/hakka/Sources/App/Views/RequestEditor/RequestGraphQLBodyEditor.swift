import HakkaCore
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
            // Only shown once there's an actual choice to make — a document
            // with a single (possibly anonymous) operation has nothing to
            // pick between, and GraphQL doesn't require `operationName` there.
            if namedOperations.count > 1 {
                Picker("Operation", selection: operationNameBinding) {
                    ForEach(namedOperations, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.menu)
            }
            Text("Variables (JSON)").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: variablesBinding)
                .font(.system(.body, design: .monospaced))
                .frame(minHeight: 80)
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(.separator))
        }
    }

    private var namedOperations: [String] {
        guard case let .graphql(query, _, _) = spec.body else { return [] }
        return GraphQLOperationParser.namedOperations(in: query)
    }

    private var queryBinding: Binding<String> {
        Binding(
            get: { if case let .graphql(query, _, _) = spec.body { query } else { "" } },
            set: { newQuery in
                guard case let .graphql(_, variables, operationName) = spec.body else { return }
                // A previously selected operation that no longer exists in
                // the edited query can't stay selected — that would send an
                // `operationName` the server has never heard of.
                let stillValid = operationName.map { GraphQLOperationParser.namedOperations(in: newQuery).contains($0) } ?? false
                spec.body = .graphql(query: newQuery, variables: variables, operationName: stillValid ? operationName : nil)
            },
        )
    }

    private var variablesBinding: Binding<String> {
        Binding(
            get: { if case let .graphql(_, variables, _) = spec.body { variables } else { "" } },
            set: { newValue in
                guard case let .graphql(query, _, operationName) = spec.body else { return }
                spec.body = .graphql(query: query, variables: newValue, operationName: operationName)
            },
        )
    }

    private var operationNameBinding: Binding<String> {
        Binding(
            get: {
                guard case let .graphql(_, _, operationName) = spec.body, let operationName,
                      namedOperations.contains(operationName)
                else {
                    return namedOperations.first ?? ""
                }
                return operationName
            },
            set: { newValue in
                guard case let .graphql(query, variables, _) = spec.body else { return }
                spec.body = .graphql(query: query, variables: variables, operationName: newValue.isEmpty ? nil : newValue)
            },
        )
    }
}
