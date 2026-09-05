// @generated — do not edit. Synced from ios/Sources/UI/Overlay/BubbleWindowConstruction.swift
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

// MARK: - BubbleWindow + Construction

extension BubbleWindow {

    func makeBubbleView() -> UIView {
        let shadow = UIView(frame: CGRect(x: 0, y: 0, width: bubbleWidth, height: bubbleHeight))
        shadow.backgroundColor = .clear
        shadow.layer.shadowColor = UIColor.black.cgColor
        shadow.layer.shadowOffset = CGSize(width: 0, height: 2)  // ui-token-check-ignore: rule/rail thickness
        shadow.layer.shadowRadius = 8
        shadow.layer.shadowOpacity = 0.25
        shadow.layer.shadowPath = UIBezierPath(
            roundedRect: shadow.bounds,
            cornerRadius: bubbleCornerRadius
        ).cgPath
        shadow.isAccessibilityElement = true
        shadow.accessibilityTraits = .button
        shadow.accessibilityHint = "Double tap to preview recent requests. Touch and hold to open the network monitor."
        // VoiceOver's activation gesture only triggers a plain tap, so the
        // long-press-to-open-inspector and drag-to-dismiss gestures above
        // are otherwise unreachable without these. Handlers live alongside
        // the gestures they mirror, in BubbleWindowGestures.swift.
        shadow.accessibilityCustomActions = [
            UIAccessibilityCustomAction(
                name: "Open network monitor",
                target: self,
                selector: #selector(openMonitorAccessibilityAction(_:))
            ),
            UIAccessibilityCustomAction(
                name: "Dismiss bubble",
                target: self,
                selector: #selector(dismissBubbleAccessibilityAction(_:))
            ),
        ]

        // Glass effect view
        let ev = UIVisualEffectView()
        ev.frame = shadow.bounds
        ev.layer.cornerRadius = bubbleCornerRadius
        ev.clipsToBounds = true
        ev.effect = makeGlassEffect()
        ev.contentView.backgroundColor = UIColor(red: 0x12 / 255, green: 0x19 / 255, blue: 0x23 / 255, alpha: 0.62)

        shadow.addSubview(ev)
        self.effectView = ev

        // Border ring for definition against any background
        let borderLayer = CAShapeLayer()
        borderLayer.path = UIBezierPath(
            roundedRect: ev.bounds.insetBy(dx: 0.5, dy: 0.5),
            cornerRadius: bubbleCornerRadius - 0.5
        ).cgPath
        borderLayer.fillColor = UIColor.clear.cgColor
        borderLayer.strokeColor = UIColor(red: 0x25 / 255, green: 0x32 / 255, blue: 0x44 / 255, alpha: 0.95).cgColor
        borderLayer.lineWidth = 0.75
        ev.layer.addSublayer(borderLayer)

        // Health stroke — request success rate drawn around the capsule.
        let trackRing = CAShapeLayer()
        let ringRect = ev.bounds.insetBy(dx: 2.5, dy: 2.5)
        let ringPath = UIBezierPath(roundedRect: ringRect, cornerRadius: bubbleCornerRadius - 2.5)
        trackRing.path = ringPath.cgPath
        trackRing.fillColor = UIColor.clear.cgColor
        trackRing.strokeColor = UIColor.white.withAlphaComponent(0.10).cgColor
        trackRing.lineWidth = 2.5
        trackRing.lineCap = .round
        ev.contentView.layer.addSublayer(trackRing)

        // Progress ring (colored, starts from top)
        let ring = CAShapeLayer()
        ring.path = ringPath.cgPath
        ring.fillColor = UIColor.clear.cgColor
        ring.strokeColor = UIColor(red: 0x22 / 255, green: 0xC5 / 255, blue: 0x5E / 255, alpha: 0.75).cgColor
        ring.lineWidth = 2.5
        ring.lineCap = .round
        ring.strokeEnd = 0
        ev.contentView.layer.addSublayer(ring)
        self.ringLayer = ring

        let numLabel = UILabel()
        numLabel.font = scaledValueFont(size: 15, weight: .heavy)
        numLabel.adjustsFontForContentSizeCategory = true
        numLabel.textColor = .white
        numLabel.textAlignment = .center
        self.numeratorLabel = numLabel

        let denomLabel = UILabel()
        denomLabel.font = scaledCaptionFont(size: 8, weight: .heavy)
        denomLabel.adjustsFontForContentSizeCategory = true
        denomLabel.textColor = UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)
        denomLabel.textAlignment = .center
        denomLabel.text = "req"
        self.denominatorLabel = denomLabel

        let requestStack = metricStack(value: numLabel, caption: denomLabel)

        let firstDivider = makeMetricDivider()
        let secondDivider = makeMetricDivider()
        let thirdDivider = makeMetricDivider()

        let networkLabel = UILabel()
        networkLabel.font = scaledValueFont(size: 15, weight: .heavy)
        networkLabel.adjustsFontForContentSizeCategory = true
        networkLabel.textColor = UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)
        networkLabel.textAlignment = .center
        self.networkLabel = networkLabel

        let networkCaption = UILabel()
        networkCaption.font = scaledCaptionFont(size: 8, weight: .heavy)
        networkCaption.adjustsFontForContentSizeCategory = true
        networkCaption.textColor = UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)
        networkCaption.textAlignment = .center
        networkCaption.text = "lat"
        self.networkCaptionLabel = networkCaption

        let networkStack = metricStack(value: networkLabel, caption: networkCaption)

        let perfLabel = UILabel()
        perfLabel.font = scaledValueFont(size: 15, weight: .heavy)
        perfLabel.adjustsFontForContentSizeCategory = true
        perfLabel.textColor = UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)
        perfLabel.textAlignment = .center
        self.performanceLabel = perfLabel

        let perfCaption = UILabel()
        perfCaption.font = scaledCaptionFont(size: 8, weight: .heavy)
        perfCaption.adjustsFontForContentSizeCategory = true
        perfCaption.textColor = UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)
        perfCaption.textAlignment = .center
        perfCaption.text = "fps"
        self.performanceCaptionLabel = perfCaption

        let performanceStack = metricStack(value: perfLabel, caption: perfCaption)

        let slowLabel = UILabel()
        slowLabel.font = scaledValueFont(size: 15, weight: .heavy)
        slowLabel.adjustsFontForContentSizeCategory = true
        slowLabel.textColor = UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)
        slowLabel.textAlignment = .center
        self.slowFrameLabel = slowLabel

        let slowCaption = UILabel()
        slowCaption.font = scaledCaptionFont(size: 8, weight: .heavy)
        slowCaption.adjustsFontForContentSizeCategory = true
        slowCaption.textColor = UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)
        slowCaption.textAlignment = .center
        slowCaption.text = "slow"
        self.slowFrameCaptionLabel = slowCaption

        let slowStack = metricStack(value: slowLabel, caption: slowCaption)

        self.dividerViews = [firstDivider, secondDivider, thirdDivider]

        let contentStack = UIStackView(arrangedSubviews: [
            requestStack,
            firstDivider,
            networkStack,
            secondDivider,
            performanceStack,
            thirdDivider,
            slowStack,
        ])
        contentStack.axis = .horizontal
        contentStack.alignment = .center
        contentStack.distribution = .fill
        contentStack.spacing = 5
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        ev.contentView.addSubview(contentStack)

        NSLayoutConstraint.activate([
            contentStack.leadingAnchor.constraint(equalTo: ev.contentView.leadingAnchor, constant: 10),
            contentStack.trailingAnchor.constraint(equalTo: ev.contentView.trailingAnchor, constant: -10),
            contentStack.centerYAnchor.constraint(equalTo: ev.contentView.centerYAnchor),
            requestStack.widthAnchor.constraint(equalToConstant: 42),
            networkStack.widthAnchor.constraint(equalToConstant: 44),
            performanceStack.widthAnchor.constraint(equalToConstant: 42),
            slowStack.widthAnchor.constraint(equalToConstant: 42),
            firstDivider.widthAnchor.constraint(equalToConstant: 1),
            secondDivider.widthAnchor.constraint(equalToConstant: 1),
            thirdDivider.widthAnchor.constraint(equalToConstant: 1),
            firstDivider.heightAnchor.constraint(equalToConstant: 24),
            secondDivider.heightAnchor.constraint(equalToConstant: 24),
            thirdDivider.heightAnchor.constraint(equalToConstant: 24),
        ])

        // Gestures. Long-press and drag share a prefix (both start as "finger
        // down, hasn't moved yet"), so the long-press's own `allowableMovement`
        // slop plus `require(toFail:)` on both tap and pan is what keeps a
        // reposition-drag from ever recognizing as a long-press and opening
        // the sheet: once the touch travels past the slop, the long-press
        // recognizer fails on its own (built-in UIKit behavior), which is the
        // exact moment tap/pan are unblocked to take over. A long-press that
        // *does* recognize (finger held still past `minimumPressDuration`)
        // means tap/pan never got a qualifying touch, so they simply never fire.
        let longPress = UILongPressGestureRecognizer(target: self, action: #selector(bubbleLongPressed(_:)))
        longPress.minimumPressDuration = 0.45
        longPress.allowableMovement = 10
        shadow.addGestureRecognizer(longPress)

        let tap = UITapGestureRecognizer(target: self, action: #selector(bubbleTapped))
        tap.require(toFail: longPress)
        shadow.addGestureRecognizer(tap)

        let pan = UIPanGestureRecognizer(target: self, action: #selector(bubblePanned(_:)))
        pan.require(toFail: longPress)
        shadow.addGestureRecognizer(pan)

        return shadow
    }

    private func metricStack(value: UILabel, caption: UILabel) -> UIStackView {
        let stack = UIStackView(arrangedSubviews: [value, caption])
        stack.axis = .vertical
        stack.alignment = .center
        stack.distribution = .fill
        stack.spacing = -1
        value.adjustsFontSizeToFitWidth = true
        value.minimumScaleFactor = 0.72
        caption.adjustsFontSizeToFitWidth = true
        caption.minimumScaleFactor = 0.82
        value.setContentCompressionResistancePriority(.required, for: .horizontal)
        caption.setContentCompressionResistancePriority(.required, for: .horizontal)
        return stack
    }

    private func makeMetricDivider() -> UIView {
        let divider = UIView()
        divider.backgroundColor = UIColor.white.withAlphaComponent(0.12)
        divider.translatesAutoresizingMaskIntoConstraints = false
        return divider
    }

    /// Scales a metric-card value label with the user's preferred text size
    /// (relative to `.footnote`, the closest system style to 15pt) instead of
    /// staying pinned to a fixed point size. Capped a few points above the
    /// base — this is a fixed 244x58 HUD capsule, not a scrolling list, so
    /// unbounded growth at the largest accessibility sizes would blow past
    /// its layout rather than just becoming more readable.
    private func scaledValueFont(size: CGFloat, weight: UIFont.Weight) -> UIFont {
        let base = UIFont.monospacedDigitSystemFont(ofSize: size, weight: weight)
        return UIFontMetrics(forTextStyle: .footnote).scaledFont(for: base, maximumPointSize: size + 5)
    }

    /// Same as `scaledValueFont`, for the small caption labels underneath
    /// each value (relative to `.caption2`), capped tighter since a caption
    /// sits directly under an already-scaled value label.
    private func scaledCaptionFont(size: CGFloat, weight: UIFont.Weight) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: weight)
        return UIFontMetrics(forTextStyle: .caption2).scaledFont(for: base, maximumPointSize: size + 3)
    }
}
#endif
