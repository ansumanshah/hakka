// @generated — do not edit. Synced from ios/Sources/UI/Overlay/BubbleWindowRuntime.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import Foundation
import UIKit
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif
#if canImport(HakkaPerformance)
import HakkaPerformance
#endif

// MARK: - BubbleWindow + Runtime
//
// Background upkeep that runs continuously while the bubble is visible:
// idle-fade timing, the store poll that keeps stats live, frame-metric
// sampling, and keyboard avoidance.

extension BubbleWindow {

    // MARK: Idle Fade

    func scheduleIdleFade() {
        idleWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, let bubble = self.bubbleView, !self.isDragging else { return }
            UIView.animate(withDuration: 0.8) { bubble.alpha = self.idleAlpha }
        }
        idleWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + idleDelay, execute: work)
    }

    func wakeFromIdle() {
        guard let bubble = bubbleView else { return }
        if bubble.alpha < 1 {
            UIView.animate(withDuration: 0.2) { bubble.alpha = 1 }
        }
        scheduleIdleFade()
    }

    // MARK: Store Observation

    func observeStore() {
        // Poll the store every 0.5s for new requests (matches RequestListView cadence)
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.syncStats()
            }
        }
    }

    func syncStats() {
        let summary = HakkaInterceptor.shared.networkMetricsSummary()
        let oldTotal = stats.total
        stats = BubbleStats(summary: summary)
        updateDisplay()
        if stats.total > oldTotal { wakeFromIdle() }
        // Keep the HUD's request list live while it's open. Skipped mid-drag
        // so this doesn't fight the pan gesture's own frame updates.
        if expansionState == .expanded, !isDragging {
            applyExpansionState(animated: false)
        }
    }

    // MARK: Performance Metrics

    func startPerformanceMetrics() {
        guard performance == nil else { return }

        let perf = HakkaPerformance { builder in
            builder.sampleIntervalMs = 1000
            builder.tags = ["surface": "hakka-ui-bubble"]
            builder.enableFrameMetrics = true
            builder.enableMemoryMetrics = false
            builder.enableCpuMetrics = false
            builder.enableNetworkUsageMetrics = false
        }
        performanceSubscription = perf.addSink { record in
            guard let frame = record as? FrameMetricRecord else { return }
            Task { @MainActor in
                BubbleWindow.shared.recordPerformance(frame)
            }
        }
        performance = perf
        perf.start()
    }

    func stopPerformanceMetrics() {
        performanceSubscription?.cancel()
        performanceSubscription = nil
        performance?.close()
        performance = nil
        performanceStats = PerformanceFrameStats()
    }

    private func recordPerformance(_ frame: FrameMetricRecord) {
        performanceStats.record(frame: frame)
        updateDisplay()
    }

    // MARK: Keyboard

    func observeKeyboard() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillShow(_:)),
            name: UIResponder.keyboardWillShowNotification, object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillHide(_:)),
            name: UIResponder.keyboardWillHideNotification, object: nil
        )
    }

    @objc private func keyboardWillShow(_ note: Notification) {
        guard let bubble = bubbleView,
              let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
              let dur = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? TimeInterval
        else { return }
        keyboardHeight = frame.height
        let screenHeight = window?.windowScene?.screen.bounds.height ?? window?.bounds.height ?? 812
        // `bubble.frame.height` (not the `bubbleHeight` constant) — the
        // bubble may currently be the taller expanded HUD shape.
        let maxY = screenHeight - keyboardHeight - bubble.frame.height - 8
        if bubble.frame.origin.y > maxY {
            if preKeyboardOriginY == nil { preKeyboardOriginY = bubble.frame.origin.y }
            UIView.animate(withDuration: dur) { bubble.frame.origin.y = maxY }
        }
    }

    @objc private func keyboardWillHide(_ note: Notification) {
        keyboardHeight = 0
        guard let bubble = bubbleView, let originY = preKeyboardOriginY else { return }
        preKeyboardOriginY = nil
        // Mid-drag the user's own frame updates own the position — don't
        // fight the pan gesture by snapping back underneath it.
        guard !isDragging else { return }
        let dur = (note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? TimeInterval) ?? 0.25
        UIView.animate(withDuration: dur) { bubble.frame.origin.y = originY }
    }

    func removeObservers() {
        pollTimer?.invalidate(); pollTimer = nil
        if let obs = storeObserver { NotificationCenter.default.removeObserver(obs); storeObserver = nil }
        NotificationCenter.default.removeObserver(self)
    }
}
#endif
