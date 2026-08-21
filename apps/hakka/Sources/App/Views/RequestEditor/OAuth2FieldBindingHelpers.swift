import SwiftUI

/// Small `Binding` transforms the OAuth2 grant fields need: several of
/// `OAuth2Grant`'s optional String fields (client secret, scope) present as
/// a plain text field that's simply empty when unset, and `redirectPort`
/// needs a text field despite being an `Int`.
extension Binding<String?> {
    var nonOptional: Binding<String> {
        Binding<String>(
            get: { wrappedValue ?? "" },
            set: { wrappedValue = $0.isEmpty ? nil : $0 },
        )
    }
}

extension Binding<Int> {
    var stringified: Binding<String> {
        Binding<String>(
            get: { String(wrappedValue) },
            set: { if let value = Int($0) { wrappedValue = value } },
        )
    }
}
