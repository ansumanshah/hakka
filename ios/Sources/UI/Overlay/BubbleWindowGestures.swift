#if canImport(UIKit)
import Foundation
import UIKit
import HakkaCommon
import HakkaNetwork
import HakkaPerformance

// MARK: - BubbleWindow + Gestures

extension BubbleWindow {

    @objc func bubbleTapped() {
        guard let bubble = bubbleView else { return }
        UIView.animate(withDuration: 0.08, animations: {
            bubble.transform = CGAffineTransform(scaleX: 0.92, y: 0.92)
        }, completion: { _ in
            UIView.animate(withDuration: 0.15, delay: 0, usingSpringWithDamping: 0.5, initialSpringVelocity: 0) {
                bubble.transform = .identity
            }
        })

        expansionState = expansionState == .collapsed ? .expanded : .collapsed
        applyExpansionState(animated: true)
    }

    @objc func bubbleLongPressed(_ gesture: UILongPressGestureRecognizer) {
        guard gesture.state == .began else { return }
        Haptics.medium()
        presentOverlay { OverlayWindow.shared.show() }
    }

    private func presentOverlay(_ present: () -> Void) {
        window?.isHidden = true
        present()
        if let existing = dismissObserver {
            NotificationCenter.default.removeObserver(existing)
        }
        dismissObserver = NotificationCenter.default.addObserver(
            forName: .init("HakkaOverlayDismissed"), object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.window?.isHidden = false
                if let obs = self?.dismissObserver {
                    NotificationCenter.default.removeObserver(obs)
                    self?.dismissObserver = nil
                }
            }
        }
    }

    // MARK: - Expansion

    /// Grows or shrinks the bubble in place to show/hide the recent-requests
    /// HUD. The metric capsule (`effectView`) keeps its own 244x58 size the
    /// whole time — only its *position within* `bubbleView` moves (y=0 when
    /// the HUD is below it, or below the HUD's height when there isn't room
    /// beneath the bubble and it opens upward instead) — so its decorative
    /// border/ring layers, sized against its own bounds, never need
    /// recomputing. `bubbleView`'s own frame is the real hit-test region
    /// (`PassthroughWindow`), so it must always fully enclose both cards.
    func applyExpansionState(animated: Bool) {
        guard let bubble = bubbleView, let ev = effectView, let container = bubble.superview else { return }
        let gap: CGFloat = 8

        switch expansionState {
        case .collapsed:
            // Collapse back to wherever the metric card is *currently*
            // sitting on screen (its absolute Y = bubble origin + its offset
            // within the bubble), not wherever the bubble was before it
            // expanded — the bubble may have been dragged while expanded.
            let restoredOrigin = CGPoint(x: bubble.frame.origin.x, y: bubble.frame.origin.y + ev.frame.origin.y)
            let panelView = hudPanel?.view

            let reposition = {
                bubble.frame = CGRect(origin: restoredOrigin, size: CGSize(width: self.bubbleWidth, height: self.bubbleHeight))
                ev.frame = CGRect(x: 0, y: 0, width: self.bubbleWidth, height: self.bubbleHeight)
                self.updateShadowPath(evOriginY: 0)
                panelView?.alpha = 0
            }
            if animated {
                UIView.animate(
                    withDuration: 0.28, delay: 0, usingSpringWithDamping: 0.82, initialSpringVelocity: 0.4,
                    animations: reposition
                ) { _ in panelView?.removeFromSuperview() }
            } else {
                reposition()
                panelView?.removeFromSuperview()
            }
            savedPosition = restoredOrigin

        case .expanded:
            let panel = hudPanel ?? BubbleHudPanel(width: bubbleWidth)
            hudPanel = panel
            let recent = HakkaInterceptor.shared.recentRequests(count: BubbleHudPanel.rowLimit)
            let panelView = panel.update(with: recent)
            let panelHeight = panelView.frame.height

            // Anchor to the metric card's *current* on-screen position
            // (`bubble.frame.origin.y + ev.frame.origin.y`), not `bubble`'s
            // own frame directly. The 0.5s poll refresh calls this
            // repeatedly to keep the HUD's request list live, and once
            // expanded-upward `bubble.frame.origin` no longer equals the
            // metric card's position — recomputing from `bubble.frame`
            // itself would compound the upward shift on every refresh.
            // Anchoring to the card's real position keeps every call
            // idempotent regardless of how many times it runs in a row.
            let anchorX = bubble.frame.origin.x
            let anchorY = bubble.frame.origin.y + ev.frame.origin.y

            let safeTop = window?.safeAreaInsets.top ?? 44
            let safeBottom = window?.safeAreaInsets.bottom ?? 34
            let spaceBelow = container.bounds.height - safeBottom - keyboardHeight - (anchorY + bubbleHeight)
            let spaceAbove = anchorY - safeTop
            // Prefer growing downward (the natural "opens below" read); only
            // flip upward when there's genuinely more room that way, so the
            // panel never gets clamped off-screen or under the keyboard.
            let growUp = spaceBelow < (gap + panelHeight) && spaceAbove > spaceBelow

            let newHeight = bubbleHeight + gap + panelHeight
            let evOriginY: CGFloat = growUp ? panelHeight + gap : 0
            let panelOriginY: CGFloat = growUp ? 0 : bubbleHeight + gap
            let newOriginY = growUp ? max(safeTop, anchorY - (gap + panelHeight)) : anchorY
            let newOrigin = CGPoint(x: anchorX, y: newOriginY)

            if panelView.superview !== bubble { bubble.addSubview(panelView) }
            panelView.frame = CGRect(x: 0, y: panelOriginY, width: bubbleWidth, height: panelHeight)
            panelView.alpha = animated ? 0 : 1

            let apply = {
                bubble.frame = CGRect(origin: newOrigin, size: CGSize(width: self.bubbleWidth, height: newHeight))
                ev.frame = CGRect(x: 0, y: evOriginY, width: self.bubbleWidth, height: self.bubbleHeight)
                self.updateShadowPath(evOriginY: evOriginY)
                panelView.frame = CGRect(x: 0, y: panelOriginY, width: self.bubbleWidth, height: panelHeight)
                panelView.alpha = 1
            }
            if animated {
                UIView.animate(
                    withDuration: 0.28, delay: 0, usingSpringWithDamping: 0.82, initialSpringVelocity: 0.4,
                    animations: apply
                )
            } else {
                apply()
            }
            savedPosition = newOrigin
        }
    }

    /// `bubbleView`'s drop shadow is a `shadowPath` fixed in its local
    /// coordinate space (CALayer shadows don't track bounds changes), so it
    /// has to be recomputed to the metric card's current offset every time
    /// `effectView`'s position within the bubble changes.
    private func updateShadowPath(evOriginY: CGFloat) {
        bubbleView?.layer.shadowPath = UIBezierPath(
            roundedRect: CGRect(x: 0, y: evOriginY, width: bubbleWidth, height: bubbleHeight),
            cornerRadius: bubbleCornerRadius
        ).cgPath
    }

    @objc func bubblePanned(_ gesture: UIPanGestureRecognizer) {
        guard let bubble = bubbleView, let container = bubble.superview else { return }
        let t = gesture.translation(in: container)

        switch gesture.state {
        case .began:
            isDragging = true
            idleWorkItem?.cancel()
            UIView.animate(withDuration: 0.15) {
                bubble.alpha = 1
                bubble.transform = CGAffineTransform(scaleX: 1.08, y: 1.08)
            }
        case .changed:
            bubble.center = CGPoint(x: bubble.center.x + t.x, y: bubble.center.y + t.y)
            gesture.setTranslation(.zero, in: container)
            let inHideZone = bubble.center.y > container.bounds.height - hideZoneHeight
            UIView.animate(withDuration: 0.15) {
                bubble.transform = inHideZone
                    ? CGAffineTransform(scaleX: 0.7, y: 0.7)
                    : CGAffineTransform(scaleX: 1.08, y: 1.08)
                bubble.alpha = inHideZone ? 0.5 : 1
            }
        case .ended, .cancelled:
            isDragging = false
            // The user just placed the bubble deliberately (possibly while
            // the keyboard is still up and `snapToEdge` below already
            // clamps for `keyboardHeight`) — drop any pending pre-keyboard
            // Y so a later `keyboardWillHide` doesn't snap the bubble back
            // to a now-stale position and discard this drag.
            preKeyboardOriginY = nil
            if bubble.center.y > container.bounds.height - hideZoneHeight {
                savedPosition = nil
                UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseIn], animations: {
                    bubble.alpha = 0
                    bubble.transform = CGAffineTransform(translationX: 18, y: -10).scaledBy(x: 0.88, y: 0.88)
                }, completion: { _ in self.cleanup() })
                return
            }
            snapToEdge(bubble: bubble, in: container)
            scheduleIdleFade()
        default: break
        }
    }

    // MARK: - Snap

    private func snapToEdge(bubble: UIView, in container: UIView) {
        let w = container.bounds.width, h = container.bounds.height
        let safeTop = window?.safeAreaInsets.top ?? 44
        let safeBottom = window?.safeAreaInsets.bottom ?? 34
        // `bubble.frame.height` (not the `bubbleHeight` constant) so a snap
        // while the HUD is expanded doesn't clamp using the collapsed size.
        let currentHeight = bubble.frame.height
        let minY = safeTop + 10
        let maxY = h - safeBottom - 10 - currentHeight - keyboardHeight
        let targetY = max(minY, min(maxY, bubble.frame.origin.y))
        let targetX: CGFloat = bubble.center.x < w / 2 ? edgeInset : w - bubbleWidth - edgeInset

        let anim = UIViewPropertyAnimator(
            duration: 0.4,
            timingParameters: UISpringTimingParameters(dampingRatio: 0.75, initialVelocity: .zero)
        )
        anim.addAnimations {
            bubble.frame = CGRect(x: targetX, y: targetY, width: self.bubbleWidth, height: currentHeight)
            bubble.transform = .identity
        }
        anim.addCompletion { _ in self.savedPosition = bubble.frame.origin }
        anim.startAnimation()
    }
}
#endif
