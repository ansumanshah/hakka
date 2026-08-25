import Foundation
import HakkaCommon
import HakkaCore
import Observation

/// The pause inbox: mirrors `PauseStore` into the list the banner and review
/// sheet render, and owns resume/abort plus this desktop's half of the
/// timeout hazards a breakpoint pause creates.
///
/// The hazard those exist for: a device's own `BreakpointEngine.pauseRequest`
/// / `.pauseResponse` (`ios/Sources/Common/BreakpointEngine.swift`) blocks a
/// background thread on a bare `DispatchSemaphore` with **no timeout of its
/// own** — only `resume`, `abort`, or that device's own app-teardown
/// (`resumeAll`) ever wakes it. This desktop is therefore the only thing
/// that can ever un-wedge a live pause short of the user force-quitting the
/// device's app, which makes every path that can end without an explicit
/// resume/abort a bug, not an edge case. See the three decisions below.
@MainActor @Observable
final class PauseInboxModel {
    private let channel: PauseControlChannel
    /// How long a pause may sit unanswered before this desktop resolves it
    /// on the developer's behalf, by sending `breakpoint.abort`.
    ///
    /// DECISION 1 — the desktop never answers (developer stepped away, got
    /// pulled into a meeting, closed the laptop lid without quitting): a
    /// per-pause watchdog (`scheduleTimeoutIfNeeded`) fires an auto-abort
    /// after this interval. Long enough to actually read and edit a request;
    /// short enough that a forgotten pause doesn't leave a real device's
    /// network stack blocked for the rest of the day. Instance property
    /// (not a static constant) so tests can inject a millisecond-scale value
    /// instead of waiting on the real 5 minutes.
    private let autoAbortTimeout: Duration

    private(set) var entries: [PendingPause] = []
    /// Transient delivery feedback — same shape as `RulesModel.deliveryNote`.
    private(set) var deliveryNote: String?

    /// pauseId -> its running timeout `Task`, so a resume/abort (manual or
    /// timeout-triggered) can cancel the watchdog instead of leaving it to
    /// fire a redundant abort against an already-resolved pause.
    @ObservationIgnored
    private var timeouts: [String: Task<Void, Never>] = [:]

    init(channel: PauseControlChannel, autoAbortTimeout: Duration = .seconds(300)) {
        self.channel = channel
        self.autoAbortTimeout = autoAbortTimeout
    }

    var hasPending: Bool { !entries.isEmpty }

    /// Mirrors the store for as long as the calling task lives, scheduling
    /// this desktop's auto-abort watchdog for every pause id that does not
    /// already have one running. Subscribes BEFORE reading the seed snapshot
    /// — a fresh `subscribeChanges()` stream (ADR 0013) only yields
    /// mutations that happen after it's created, so seeding first would
    /// risk losing one that lands between the read and the subscribe call.
    /// Subscribing first can instead replay a mutation the seed read already
    /// saw; `scheduleTimeoutIfNeeded` is itself idempotent (guards on a
    /// timeout already running for that id), so a re-seen entry schedules
    /// nothing twice.
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

    /// Releases a pause with edits matching its own phase — `requestEdits`
    /// for a request-phase pause, `responseEdits` for a response-phase one
    /// (the wire's `breakpoint.resume` carries both fields; only one is ever
    /// meaningful for a given pause, per its `phase`).
    func resume(_ pause: PendingPause, requestEdits: BreakpointRequestEdits? = nil, responseEdits: BreakpointResponseEdits? = nil) {
        resolve(pause, command: .breakpointResume(pauseId: pause.pauseId, requestEdits: requestEdits, responseEdits: responseEdits))
    }

    /// Fails the request with a network-error-shaped failure on the device —
    /// never a fabricated HTTP status, since none was actually returned.
    func abort(_ pause: PendingPause) {
        resolve(pause, command: .breakpointAbort(pauseId: pause.pauseId))
    }

    /// Sends before removing locally — the opposite order from
    /// `RulesModel.setEnabled`/`.remove`, deliberately, for the same reason
    /// `RulesModel.promote` does: there is no on-screen toggle here to keep
    /// responsive through a round trip, only a one-shot action the user
    /// waits on, so the entry stays in the inbox — actionable — until the
    /// device has actually been told to proceed. A send that throws leaves
    /// the pause exactly where it was, editable and resend-able; a `0`
    /// delivered count is not a failure (mirrors `ControlSender`) but is
    /// still surfaced, since a pause a resume was sent for and reached no
    /// device is not the same as one that was actually released.
    ///
    /// `reason`, when non-nil, prefixes the eventual delivery note — used by
    /// the timeout watchdog so "Timed out…" survives instead of being
    /// clobbered the instant the auto-abort's own send resolves (which, for
    /// an already-connected device, can be faster than the caller can read
    /// an intermediate `deliveryNote` value).
    private func resolve(_ pause: PendingPause, command: ControlCommand, reason: String? = nil) {
        cancelTimeout(pause.pauseId)
        Task {
            do {
                let delivered = try await channel.send(command)
                await channel.pauses.remove(pauseId: pause.pauseId)
                note(delivered, reason: reason)
            } catch {
                // The pause stays in the inbox for retry (unchanged above),
                // but its watchdog was just cancelled — re-arm it, or a
                // single transient send failure permanently strands the
                // device on a semaphore with no other way to wake it.
                scheduleTimeoutIfNeeded(pause)
                note(error, reason: reason)
            }
        }
    }

    /// DECISION 3 — the app quits with pauses outstanding: without this,
    /// closing the Mac app would leave every still-paused device blocked
    /// forever, since nothing else (not the device, whose `resumeAll` only
    /// runs on ITS OWN teardown) will ever resume or abort them. The one
    /// caller is `AppDelegate.applicationShouldTerminate`, which holds
    /// termination open (`.terminateLater`) just long enough for this to
    /// run. Best-effort: errors are swallowed (there is no UI left to report
    /// to, and quitting must not hang waiting on a network write), and every
    /// pause is attempted even if an earlier one fails or times out.
    func abortAllForTermination() async {
        for pause in entries {
            cancelTimeout(pause.pauseId)
            _ = try? await channel.send(.breakpointAbort(pauseId: pause.pauseId))
        }
    }

    // MARK: - Timeout

    /// DECISION 2 — the device disconnects mid-pause: the wire carries no
    /// peer/socket identity inside `breakpoint.paused` (`device` is a
    /// free-text label, not a connection handle), so this store cannot tell
    /// "that device dropped" apart from "that device is just slow to
    /// reconnect." Rather than guess, a disconnected device's pause is left
    /// to resolve the same way an unanswered one does — `autoAbortTimeout`
    /// above — and a manual resume/abort against it is reported honestly via
    /// `note(_:Int)`: `ControlSender` returning `0` delivered means the abort
    /// reached no one, so the developer sees "no devices connected" instead
    /// of a false "resolved."
    private func scheduleTimeoutIfNeeded(_ pause: PendingPause) {
        guard timeouts[pause.pauseId] == nil else { return }
        let pauseId = pause.pauseId
        let timeout = autoAbortTimeout
        timeouts[pauseId] = Task { [weak self] in
            try? await Task.sleep(for: timeout)
            guard !Task.isCancelled, let self else { return }
            // The pause may have vanished from `entries` without ever going
            // through `resolve(_:command:reason:)` — e.g. removed directly
            // from the store by another path. `resolve` is what normally
            // clears this watchdog's own `timeouts[pauseId]` slot
            // (`cancelTimeout`), so this early-exit path must clear it too:
            // otherwise the slot leaks forever, and if the same pauseId is
            // ever re-ingested, `scheduleTimeoutIfNeeded`'s `timeouts[...] ==
            // nil` guard sees the stale entry and silently skips scheduling
            // a fresh watchdog for it.
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
