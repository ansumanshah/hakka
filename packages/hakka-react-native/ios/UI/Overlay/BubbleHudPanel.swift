// @generated — do not edit. Synced from ios/Sources/UI/Overlay/BubbleHudPanel.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import UIKit
#if canImport(HakkaCommon)
import HakkaCommon
#endif

// MARK: - BubbleHudPanel

/// The compact "recent requests" card `BubbleWindow` reveals below (or above,
/// near a screen edge) its collapsed capsule on tap. Self-contained — owns
/// its own view, shadow, and rows — so `BubbleWindow` only calls
/// `update(with:)`, reads the returned view's size, and handles positioning
/// itself (see `BubbleWindow.applyExpansionState`), the same split as the
/// metric capsule it sits beside.
///
/// Row grammar mirrors the request list (DESIGN.md "Chips are for controls;
/// rows get plain text."): plain method-colored mono text, no chip/border,
/// and a colored status number — never the outlined `MethodBadge` chip.
@MainActor
final class BubbleHudPanel {

    /// "3-5 requests" per the decided model; 4 splits the difference and
    /// keeps the panel from ever needing more than one screen of height.
    static let rowLimit = 4

    private let width: CGFloat
    private let cornerRadius: CGFloat = 16
    private let rowHeight: CGFloat = 20
    private let rowSpacing: CGFloat = 6
    private let topPadding: CGFloat = 10
    private let bottomPadding: CGFloat = 10

    private(set) var view: UIView?
    private var effectView: UIVisualEffectView?
    private var borderLayer: CAShapeLayer?
    private var rowsStack: UIStackView?
    private var emptyLabel: UILabel?

    init(width: CGFloat) {
        self.width = width
    }

    // MARK: - Public API

    /// The panel's required height for `count` requests. Zero still reserves
    /// one row's worth of height for the empty-state message.
    func height(forRequestCount count: Int) -> CGFloat {
        let rows = max(1, min(Self.rowLimit, count))
        return topPadding + CGFloat(rows) * rowHeight + CGFloat(max(0, rows - 1)) * rowSpacing + bottomPadding
    }

    /// Builds the panel on first use, repopulates its rows from `requests`
    /// (newest first — only the first `rowLimit` are shown), resizes it to
    /// fit, and returns it. Callers own positioning/animation.
    @discardableResult
    func update(with requests: [NetworkRequest]) -> UIView {
        let panel = view ?? makePanel()
        let shown = Array(requests.prefix(Self.rowLimit))
        populate(shown)
        let newHeight = height(forRequestCount: shown.count)
        panel.frame.size = CGSize(width: width, height: newHeight)
        // Force `effectView`'s autoresizingMask-driven resize (Auto Layout
        // under the hood, so otherwise deferred to the next layout pass) to
        // happen now, before reading its bounds below.
        panel.layoutIfNeeded()
        panel.layer.shadowPath = UIBezierPath(roundedRect: panel.bounds, cornerRadius: cornerRadius).cgPath
        // `effectView` tracks the wrapper's new bounds via autoresizingMask,
        // but the border's CAShapeLayer path is a fixed CGPath in its own
        // coordinate space and needs recomputing against that new size —
        // same reason `BubbleWindow.updateShadowPath` exists.
        if let ev = effectView {
            borderLayer?.path = UIBezierPath(
                roundedRect: ev.bounds.insetBy(dx: 0.5, dy: 0.5), cornerRadius: cornerRadius - 0.5
            ).cgPath
        }
        return panel
    }

    // MARK: - Construction

    private func makePanel() -> UIView {
        let wrapper = UIView(frame: CGRect(x: 0, y: 0, width: width, height: topPadding + bottomPadding + rowHeight))
        wrapper.backgroundColor = .clear
        wrapper.layer.shadowColor = UIColor.black.cgColor
        wrapper.layer.shadowOffset = CGSize(width: 0, height: 2)  // ui-token-check-ignore: rule/rail thickness
        wrapper.layer.shadowRadius = 8
        wrapper.layer.shadowOpacity = 0.22

        let ev = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        ev.frame = wrapper.bounds
        ev.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        ev.layer.cornerRadius = cornerRadius
        ev.clipsToBounds = true
        ev.contentView.backgroundColor = UIColor(hex: HakkaTokens.darkSurfaceRaised).withAlphaComponent(0.66)
        wrapper.addSubview(ev)
        effectView = ev

        let border = CAShapeLayer()
        border.path = UIBezierPath(
            roundedRect: ev.bounds.insetBy(dx: 0.5, dy: 0.5), cornerRadius: cornerRadius - 0.5
        ).cgPath
        border.fillColor = UIColor.clear.cgColor
        border.strokeColor = UIColor(hex: HakkaTokens.darkBorder).withAlphaComponent(0.9).cgColor
        border.lineWidth = 0.75
        ev.layer.addSublayer(border)
        borderLayer = border

        let stack = UIStackView()
        stack.axis = .vertical
        stack.alignment = .fill
        stack.distribution = .fill
        stack.spacing = rowSpacing
        stack.translatesAutoresizingMaskIntoConstraints = false
        ev.contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: ev.contentView.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: ev.contentView.trailingAnchor, constant: -12),
            stack.topAnchor.constraint(equalTo: ev.contentView.topAnchor, constant: topPadding),
        ])
        rowsStack = stack

        let empty = UILabel()
        empty.font = .systemFont(ofSize: 11, weight: .medium)
        empty.textColor = UIColor(hex: HakkaTokens.darkTextTertiary)
        empty.text = "No requests yet"
        emptyLabel = empty

        view = wrapper
        return wrapper
    }

    private func populate(_ requests: [NetworkRequest]) {
        guard let stack = rowsStack, let empty = emptyLabel else { return }
        stack.arrangedSubviews.forEach {
            stack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        guard !requests.isEmpty else {
            stack.addArrangedSubview(empty)
            return
        }
        for request in requests {
            stack.addArrangedSubview(makeRow(for: request))
        }
    }

    private func makeRow(for request: NetworkRequest) -> UIView {
        let method = UILabel()
        method.font = .monospacedSystemFont(ofSize: 10, weight: .bold)
        method.textColor = methodColor(for: request.method)
        method.text = request.method.rawValue
        method.setContentHuggingPriority(.required, for: .horizontal)
        method.widthAnchor.constraint(equalToConstant: 40).isActive = true

        let path = UILabel()
        path.font = .systemFont(ofSize: 11, weight: .regular)
        path.textColor = UIColor(hex: HakkaTokens.darkTextSecondary)
        path.text = pathText(for: request)
        path.lineBreakMode = .byTruncatingMiddle
        path.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let status = UILabel()
        status.font = .monospacedSystemFont(ofSize: 10, weight: .bold)
        status.textAlignment = .right
        status.textColor = statusColor(for: request)
        status.text = statusText(for: request)
        status.setContentHuggingPriority(.required, for: .horizontal)
        status.widthAnchor.constraint(equalToConstant: 32).isActive = true

        let row = UIStackView(arrangedSubviews: [method, path, status])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 6
        row.heightAnchor.constraint(equalToConstant: rowHeight).isActive = true
        return row
    }

    // MARK: - Formatting (mirrors `RequestRowView`'s plain-text row grammar)

    private func pathText(for request: NetworkRequest) -> String {
        let path = URL(string: request.url)?.path ?? request.url
        return path.isEmpty ? "/" : path
    }

    private func statusText(for request: NetworkRequest) -> String {
        if let code = request.status { return "\(code)" }
        if request.error != nil { return "ERR" }
        return "\u{22EF}"
    }

    private func statusColor(for request: NetworkRequest) -> UIColor {
        if let code = request.status {
            switch code {
            case 200..<300: return UIColor(hex: HakkaTokens.statusSuccess)
            case 300..<400: return UIColor(hex: HakkaTokens.statusWarning)
            case 400..<600: return UIColor(hex: HakkaTokens.statusError)
            default: return UIColor(hex: HakkaTokens.statusPending)
            }
        }
        if request.error != nil { return UIColor(hex: HakkaTokens.statusError) }
        return UIColor(hex: HakkaTokens.statusPending)
    }

    private func methodColor(for method: HttpMethod) -> UIColor {
        switch method {
        case .get: return UIColor(hex: HakkaTokens.methodGet)
        case .post: return UIColor(hex: HakkaTokens.methodPost)
        case .put: return UIColor(hex: HakkaTokens.methodPut)
        case .patch: return UIColor(hex: HakkaTokens.methodPatch)
        case .delete: return UIColor(hex: HakkaTokens.methodDelete)
        case .head, .options: return UIColor(hex: HakkaTokens.statusPending)
        }
    }
}
#endif
