import HakkaCore
import SwiftUI

/// Always-visible method + status-range chips above the traffic list — the
/// clickable counterpart to the DSL tokens `TrafficQueryCompiler` already
/// understands (`method:GET`, `4xx`, …). A chip reads and writes
/// `model.traffic.searchText` directly: tapping one inserts or removes the
/// matching DSL token from that text, then the existing
/// `TrafficQueryParser` → `TrafficQueryCompiler` pipeline
/// (`TrafficModel+Search.swift`) filters the list exactly as if the token
/// had been typed — no compiler API changes, this view is a read-only
/// caller.
///
/// Per `swiftui-patterns.md`: method labels in *list rows* stay plain
/// colored text, never chips — a filter bar is the interactive context chips
/// are reserved for, matching the RN/web/iOS filter-bar grammar
/// (`FiltersMethodChips.tsx`, `ios/Sources/UI/List/FilterBar.swift`).
struct TrafficFilterChipsView: View {
    @Binding var searchText: String

    var body: some View {
        // Parsed once per render rather than once per chip — nine tokens'
        // worth of redundant `TrafficQueryParser.parse` calls otherwise,
        // since a chip's active state and its neighbours' all come from the
        // same `searchText`.
        let query = TrafficQueryParser.parse(searchText)
        HStack(spacing: Spacing.sm) {
            ForEach(TrafficFilterChips.methods, id: \.self) { method in
                chip(method, isActive: TrafficFilterChips.activeMethod(in: query) == method, tone: Fmt.methodColor(for: method)) {
                    searchText = TrafficFilterChips.togglingMethod(method, in: searchText)
                }
                .accessibilityLabel("\(method) method filter")
            }
            Divider().frame(height: ControlHeight.chip)
            ForEach(TrafficFilterChips.statusClasses, id: \.self) { statusClass in
                chip(statusClass, isActive: TrafficFilterChips.activeStatusClass(in: query) == statusClass, tone: Self.statusTone(statusClass)) {
                    searchText = TrafficFilterChips.togglingStatusClass(statusClass, in: searchText)
                }
                .accessibilityLabel("\(statusClass) status filter")
            }
        }
    }

    /// DESIGN.md's "Method chips" grammar: outlined mono tints — colored
    /// text, ~40% border, ~10% background tint, never a filled pill. Fixed
    /// `minWidth` so "GET" and "DELETE" sit in same-width boxes.
    private func chip(_ label: String, isActive: Bool, tone: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.caption2.monospaced().weight(.bold))
                .foregroundStyle(isActive ? tone : .secondary)
                .padding(.horizontal, Spacing.sm)
                .frame(height: ControlHeight.chip)
                .frame(minWidth: 48)
                .background(isActive ? tone.opacity(0.1) : Color.clear, in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.md)
                        .stroke(isActive ? tone.opacity(0.4) : Color.secondary.opacity(0.25), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    /// Jade/steel/turmeric/chili — the same status-class → tone mapping as
    /// `TrafficRowSeverity` and iOS's `FilterBar.statusChipTone`. Not
    /// `Fmt.statusColor`, which folds 4xx and 5xx into one "error" tone for
    /// the row's single status-number cell — too coarse for a chip that has
    /// to tell the two classes apart.
    private static func statusTone(_ statusClass: String) -> Color {
        switch statusClass {
        case "2xx": ThemeTokens.Status.success
        case "3xx": ThemeTokens.Status.info
        case "4xx": ThemeTokens.Status.warning
        case "5xx": ThemeTokens.Status.error
        default: ThemeTokens.Status.pending
        }
    }
}

/// The chip labels plus the pure text transforms behind them, kept free of
/// SwiftUI so a test can assert a chip tap and its equivalent typed DSL
/// token parse to the same `TrafficQuery` without instantiating a view.
enum TrafficFilterChips {
    static let methods = ["GET", "POST", "PUT", "PATCH", "DELETE"]
    static let statusClasses = ["2xx", "3xx", "4xx", "5xx"]

    /// The positively-filtered method currently in `searchText`, or nil when
    /// there is none (or it's negated — `-method:GET` isn't "GET selected",
    /// it's the opposite). Uppercased to compare directly against `methods`.
    static func activeMethod(in searchText: String) -> String? {
        activeMethod(in: TrafficQueryParser.parse(searchText))
    }

    static func activeMethod(in query: TrafficQuery) -> String? {
        guard let method = query.method, !query.methodNegate else { return nil }
        return method.uppercased()
    }

    /// The positively-filtered status class currently in `searchText`, or
    /// nil when there's none, it's negated, or it's some other status DSL
    /// (`>=400`, `200..299`, a bare code) this row of chips has no button
    /// for — those stay untouched by every toggle below.
    static func activeStatusClass(in searchText: String) -> String? {
        activeStatusClass(in: TrafficQueryParser.parse(searchText))
    }

    static func activeStatusClass(in query: TrafficQuery) -> String? {
        guard let dsl = query.statusDsl, !query.statusNegate else { return nil }
        let lower = dsl.lowercased()
        return statusClasses.contains(lower) ? lower : nil
    }

    /// Tapping the already-active method's chip clears it; tapping another
    /// replaces it — `TrafficQuery.method` is a single field, so only one
    /// method can ever be selected at once, matching how `method:GET
    /// method:POST` typed by hand would behave anyway (last one wins).
    static func togglingMethod(_ method: String, in searchText: String) -> String {
        var parts = tokens(in: searchText).filter { !isMethodToken($0) }
        if activeMethod(in: TrafficQueryParser.parse(searchText)) != method {
            parts.append("method:\(method)")
        }
        return parts.joined(separator: " ")
    }

    /// Same toggle-or-replace rule as `togglingMethod`, for the single
    /// `statusDsl` field. Only removes *positive* status tokens — the
    /// chips don't speak to negation, so a hand-typed `-4xx` is left alone.
    static func togglingStatusClass(_ statusClass: String, in searchText: String) -> String {
        var parts = tokens(in: searchText).filter { !isPositiveStatusToken($0) }
        if activeStatusClass(in: TrafficQueryParser.parse(searchText)) != statusClass {
            parts.append(statusClass)
        }
        return parts.joined(separator: " ")
    }

    private static func isMethodToken(_ token: String) -> Bool {
        let bare = token.hasPrefix("-") ? String(token.dropFirst()) : token
        return bare.lowercased().hasPrefix("method:")
    }

    private static func isPositiveStatusToken(_ token: String) -> Bool {
        !token.hasPrefix("-") && TrafficStatusDsl.parse(token) != nil
    }

    /// Splits on whitespace but keeps a quoted phrase — `host:"my host"` —
    /// intact as one token, so a chip toggle never tears a quoted search
    /// phrase in half. Mirrors, rather than reuses, `TrafficQueryParser`'s
    /// own splitter — that one is a private implementation detail of the
    /// parser, unreachable from here.
    private static func tokens(in text: String) -> [String] {
        var results: [String] = []
        var current = ""
        var quote: Character?
        for character in text {
            if let open = quote {
                current.append(character)
                if character == open { quote = nil }
            } else if character == "\"" || character == "'" {
                quote = character
                current.append(character)
            } else if character.isWhitespace {
                if !current.isEmpty {
                    results.append(current)
                    current = ""
                }
            } else {
                current.append(character)
            }
        }
        if !current.isEmpty { results.append(current) }
        return results
    }
}
