import Foundation
import HakkaCommon
import HakkaCore
import Observation

/// Mirrors pending pauses and resolves them through the connected device.
@MainActor @Observable
final class PauseInboxModel {
    private let channel: PauseControlChannel
    /// Unanswered pauses auto-abort after this interval to release blocked requests.
    private let autoAbortTimeout: Duration

    private(set) var entries: [PendingPause] = []
    /// Transient command-delivery feedback.
    private(set) var deliveryNote: String?

    /// Awaited by tests to observe command completion.
    private(set) var lastActionTask: Task<Void, Never>?

    /// One cancellable watchdog per pending pause.
    @ObservationIgnored
    private var timeouts: [String: Task<Void, Never>] = [:]

    init(channel: PauseControlChannel, autoAbortTimeout: Duration = .seconds(300)) {
        self.channel = channel
        self.autoAbortTimeout = autoAbortTimeout
    }

    var hasPending: Bool { !entries.isEmpty }

    /// Subscribe before seeding so changes during the snapshot read are not lost.
    func observe() async {
        let stream = await channel.pauses.subscribeChanges()
        entries = await channel.pauses.pauses()
        for entry in entries { scheduleTimeoutIfNeeded(entry) }
        for await snapshot in stream {
            let previousIDs = Set(entries.map(\.pauseId))
            entries = snapshot
            for entry in snapshot where !previousIDs.contains(entry.pauseId) {
                scheduleTimeoutIfNeeded(entry)
            }
        }
    }

    // MARK: - Actions

    /// Resume edits must match the request or response phase.
    func resume(_ pause: PendingPause, requestEdits: BreakpointRequestEdits? = nil, responseEdits: BreakpointResponseEdits? = nil) {
        resolve(pause, command: .breakpointResume(pauseId: pause.pauseId, requestEdits: requestEdits, responseEdits: responseEdits))
    }

    /// Fails the paused request with a network error.
    func abort(_ pause: PendingPause) {
        resolve(pause, command: .breakpointAbort(pauseId: pause.pauseId))
    }

    /// Remove only after sending; preserve the timeout reason in delivery feedback.
    private func resolve(_ pause: PendingPause, command: ControlCommand, reason: String? = nil) {
        cancelTimeout(pause.pauseId)
        lastActionTask = Task {
            do {
                let delivered = try await channel.send(command)
                await channel.pauses.remove(pauseId: pause.pauseId)
                note(delivered, reason: reason)
            } catch {
                // Re-arm after failed delivery so the device is not left paused indefinitely.
                scheduleTimeoutIfNeeded(pause)
                note(error, reason: reason)
            }
        }
    }

    /// Best-effort aborts before app termination; attempt every pause even if a send fails.
    func abortAllForTermination() async {
        for pause in entries {
            cancelTimeout(pause.pauseId)
            _ = try? await channel.send(.breakpointAbort(pauseId: pause.pauseId))
        }
    }

    // MARK: - Timeout

    /// Disconnected peers cannot be identified by the pause record; the same timeout applies.
    private func scheduleTimeoutIfNeeded(_ pause: PendingPause) {
        guard timeouts[pause.pauseId] == nil else { return }
        let pauseId = pause.pauseId
        let timeout = autoAbortTimeout
        timeouts[pauseId] = Task { [weak self] in
            try? await Task.sleep(for: timeout)
            guard !Task.isCancelled, let self else { return }
            // A pause removed outside resolve must release its watchdog slot for ID reuse.
            guard let current = self.entries.first(where: { $0.pauseId == pauseId }) else {
                self.timeouts.removeValue(forKey: pauseId)
                return
            }
            let minutes = max(1, Int(timeout.components.seconds) / 60)
            self.resolve(current, command: .breakpointAbort(pauseId: pauseId), reason: "Timed out after \(minutes) min")
        }
    }

    private func cancelTimeout(_ pauseId: String) {
        timeouts.removeValue(forKey: pauseId)?.cancel()
    }

    /// Lets tests await stale-watchdog cleanup without fixed sleeps.
    func debugHasTimeoutSlotForTest(_ pauseId: String) -> Bool {
        timeouts[pauseId] != nil
    }

    private func note(_ delivered: Int, reason: String? = nil) {
        let outcome = delivered == 0
            ? "No devices connected — the request may still be paused on the device"
            : "Sent to \(delivered) device\(delivered == 1 ? "" : "s")"
        deliveryNote = reason.map { "\($0) — \(outcome)" } ?? outcome
        clearNoteLater()
    }

    private func note(_ error: Error, reason: String? = nil) {
        let outcome = "Failed: \(error.localizedDescription)"
        deliveryNote = reason.map { "\($0) — \(outcome)" } ?? outcome
        clearNoteLater()
    }

    private func clearNoteLater() {
        let current = deliveryNote
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if deliveryNote == current { deliveryNote = nil }
        }
    }
}
