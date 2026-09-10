import SwiftUI

struct TLSHostScopeEditor: View {
    @Binding var scope: TLSHostScope

    var body: some View {
        Picker("TLS scope", selection: $scope.mode) {
            ForEach(TLSHostScopeMode.allCases, id: \.self) { mode in Text(mode.title).tag(mode) }
        }
        Text(scope.mode == .bypass
            ? "Bypassed hosts stay encrypted and are forwarded without TLS interception. This may help a pinned app, but does not promise compatibility."
            : "Only listed hosts are TLS-intercepted; all other TLS traffic is forwarded encrypted.")
            .font(.callout).foregroundStyle(.secondary)
        ForEach($scope.entries) { $entry in
            HStack {
                Toggle("Enable host", isOn: $entry.isEnabled).labelsHidden()
                TextField("api.example.com or *.example.com:443", text: $entry.host)
                Button("Remove", role: .destructive) { scope.entries.removeAll { $0.id == entry.id } }
            }
        }
        Button("Add TLS Host") { scope.entries.append(TLSHostScopeEntry()) }
        if let message = scope.validationMessage {
            Text(message).foregroundStyle(.red).font(.callout)
        }
    }
}
