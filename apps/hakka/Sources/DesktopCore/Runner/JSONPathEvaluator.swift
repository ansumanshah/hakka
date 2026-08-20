import Foundation

/// A minimal JSON path evaluator over `JSONSerialization` output: dot for
/// object keys, `[n]` for array indices, chainable (`data.items[0].id`,
/// `items[0][1]`). Deliberately not a general JSONPath implementation — no
/// wildcards, slices, or filter expressions — because assertions and
/// captures only ever need to point at one concrete value.
enum JSONPathEvaluator {
    /// `nil` for any segment that doesn't resolve — a missing key, an
    /// out-of-range index, or indexing into a non-container — rather than
    /// throwing, so a "does this field exist" assertion has something to test.
    static func value(at path: String, in root: Any) -> Any? {
        guard !path.isEmpty else { return root }
        var current: Any = root
        for segment in path.split(separator: ".", omittingEmptySubsequences: true) {
            guard let stepped = step(String(segment), from: current) else { return nil }
            current = stepped
        }
        return current
    }

    private static func step(_ segment: String, from current: Any) -> Any? {
        var value: Any? = current
        var remaining = Substring(segment)

        guard let bracketIndex = remaining.firstIndex(of: "[") else {
            guard let dict = value as? [String: Any] else { return nil }
            return dict[segment]
        }

        let key = String(remaining[remaining.startIndex ..< bracketIndex])
        if !key.isEmpty {
            guard let dict = value as? [String: Any] else { return nil }
            value = dict[key]
        }
        remaining = remaining[bracketIndex...]

        while remaining.hasPrefix("["), let closeIndex = remaining.firstIndex(of: "]") {
            let indexText = remaining[remaining.index(after: remaining.startIndex) ..< closeIndex]
            guard let index = Int(indexText), let array = value as? [Any], array.indices.contains(index) else { return nil }
            value = array[index]
            remaining = remaining[remaining.index(after: closeIndex)...]
        }
        return value
    }

    /// String form of a JSON value for comparison/capture: strings verbatim,
    /// numbers/bools via their natural description, containers as compact
    /// JSON text, `nil`/`NSNull` as `nil` (an absent or JSON-null value reads
    /// the same to an assertion's `exists`/`notExists`).
    static func stringify(_ value: Any?) -> String? {
        guard let value, !(value is NSNull) else { return nil }
        if let string = value as? String { return string }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "true" : "false" }
            if number.doubleValue == number.doubleValue.rounded(), number.doubleValue.magnitude < 1e15 {
                return String(number.int64Value)
            }
            return number.stringValue
        }
        if JSONSerialization.isValidJSONObject(value),
           let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            return text
        }
        return "\(value)"
    }
}
