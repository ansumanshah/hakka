import HakkaCommon

extension TrafficStore {
    public func exportSession(name: String) -> TrafficSession {
        TrafficSession(name: name, requests: all())
    }

    /// Loads `session` into the buffer. `replacing: true` (the default)
    /// clears the current buffer first; `false` appends on top, subject to
    /// the buffer's normal eviction once it's full.
    public func importSession(_ session: TrafficSession, replacing: Bool = true) {
        if replacing { clear() }
        append(contentsOf: session.requests)
    }

    /// HAR 1.2 export. Delegates to `HarExporter` in
    /// `ios/Sources/Common/Export/HarExporter.swift` — the field mapping
    /// lives there once, shared with iOS/RN/web, not reinvented here.
    public func exportHar(prettyPrint: Bool = false) -> String? {
        HarExporter.export(all(), prettyPrint: prettyPrint)
    }
}
