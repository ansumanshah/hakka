import Foundation
import HakkaCore

/// Session export/import — split out of `TrafficModel.swift` to keep that
/// file under the 200-line convention. Reaches `store`/`deviceIndex` on
/// `TrafficModel`, which are `internal` rather than `private` for exactly
/// this reason.
@MainActor
extension TrafficModel {
    /// The captured buffer as a `.hakka-session` document.
    func exportSession(named name: String) async -> Data? {
        let session = await store.exportSession(name: name)
        return try? TrafficSessionCodec.encode(session)
    }

    /// HAR 1.2, for handing the capture to a tool that isn't Hakka.
    func exportHar() async -> Data? {
        guard let json = await store.exportHar(prettyPrint: true) else { return nil }
        return Data(json.utf8)
    }

    /// Replaces the buffer with a saved session. Returns an error message on
    /// failure rather than throwing, since every caller is a menu action whose
    /// only recourse is to show it.
    func importSession(from data: Data) async -> String? {
        do {
            let session = try TrafficSessionCodec.decode(data)
            await store.importSession(session)
            // An imported session carries no bridge peer — nothing to
            // honestly attribute a device to, so the index is cleared
            // rather than left showing stale labels from the live session.
            deviceIndex.removeAll()
            setBuffer(await store.all(), stats: await store.stats())
            selectedRequestID = nil
            comparisonBaselineID = nil
            return nil
        } catch {
            return "Could not open that session: \(error.localizedDescription)"
        }
    }
}
