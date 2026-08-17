import Foundation

extension Dictionary where Key == String, Value == [String] {
    /// Returns the first value for a header name, performing a case-insensitive match.
    func firstValue(_ name: String) -> String? {
        let lower = name.lowercased()
        return first { $0.key.lowercased() == lower }?.value.first
    }
}
