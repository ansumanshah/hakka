// @generated — do not edit. Synced from ios/Sources/UI/Theme.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
import UIKit
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif

// MARK: - Color(hex:)

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    /// Adaptive color: dark variant in dark UI style, light variant in light UI style.
    init(darkHex: UInt32, lightHex: UInt32) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(hex: darkHex)
                : UIColor(hex: lightHex)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

// MARK: - Theme

/// Centralized design tokens for Hakka UI.
/// Colors adapt to the system appearance automatically (dark and light).
/// Token values come from HakkaTokens (generated from design-tokens.json — shared with RN + Android).
enum Theme {

    // MARK: - Backgrounds

    static let bg = Color(darkHex: HakkaTokens.darkBackground, lightHex: HakkaTokens.lightBackground)
    static let surface = Color(darkHex: HakkaTokens.darkSurface, lightHex: HakkaTokens.lightSurface)
    static let surfaceRaised = Color(darkHex: HakkaTokens.darkSurfaceRaised, lightHex: HakkaTokens.lightSurfaceRaised)
    static let border = Color(darkHex: HakkaTokens.darkBorder, lightHex: HakkaTokens.lightBorder)
    static let chromeTint = Color(darkHex: HakkaTokens.darkSurface, lightHex: HakkaTokens.lightSurface).opacity(0.62)
    static let controlTint = Color(darkHex: HakkaTokens.darkSurfaceRaised, lightHex: HakkaTokens.lightSurfaceRaised).opacity(0.74)

    // MARK: - Accent (flame — active/selected/primary/focus ONLY, see DESIGN.md)

    /// The single flame accent. Reserved for active tab, selected row, primary
    /// buttons, and focus states. Never used for informational 3xx/info — that's `info` (steel).
    static let accent = Color(darkHex: HakkaTokens.darkAccent, lightHex: HakkaTokens.lightAccent)

    // MARK: - Text

    static let text = Color(darkHex: HakkaTokens.darkText, lightHex: HakkaTokens.lightText)
    static let textSecondary = Color(darkHex: HakkaTokens.darkTextSecondary, lightHex: HakkaTokens.lightTextSecondary)
    static let textTertiary = Color(darkHex: HakkaTokens.darkTextTertiary, lightHex: HakkaTokens.lightTextTertiary)

    // MARK: - Status

    static let success = Color(hex: HakkaTokens.statusSuccess)
    static let info = Color(hex: HakkaTokens.statusInfo)
    static let warning = Color(hex: HakkaTokens.statusWarning)
    static let error = Color(hex: HakkaTokens.statusError)
    static let pending = Color(hex: HakkaTokens.statusPending)

    // MARK: - Method Badges

    static let methodGet = Color(hex: HakkaTokens.methodGet)
    static let methodPost = Color(hex: HakkaTokens.methodPost)
    static let methodPut = Color(hex: HakkaTokens.methodPut)
    static let methodPatch = Color(hex: HakkaTokens.methodPatch)
    static let methodDelete = Color(hex: HakkaTokens.methodDelete)

    // MARK: - JSON Syntax (light/dark adaptive — readable on both backgrounds)

    static let jsonKey = Color(.label)                 // black / white — bold weight distinguishes
    static let jsonString = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(hex: HakkaTokens.codeDarkString)
        : UIColor(hex: HakkaTokens.codeLightString)
    })
    static let jsonNumber = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(hex: HakkaTokens.codeDarkNumber)
        : UIColor(hex: HakkaTokens.codeLightNumber)
    })
    static let jsonBool = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(hex: HakkaTokens.codeDarkBoolean)
        : UIColor(hex: HakkaTokens.codeLightBoolean)
    })
    static let jsonNull = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(hex: HakkaTokens.codeDarkNull)
        : UIColor(hex: HakkaTokens.codeLightNull)
    })
    static let jsonPunctuation = Color(.secondaryLabel) // braces, commas, colons

    // MARK: - Timing Phases

    static let timingDNS = Color(hex: HakkaTokens.timingDns)
    static let timingTCP = Color(hex: HakkaTokens.timingTcp)
    static let timingTLS = Color(hex: HakkaTokens.timingTls)
    static let timingTTFB = Color(hex: HakkaTokens.timingTtfb)
    static let timingDownload = Color(hex: HakkaTokens.timingDownload)

    // MARK: - Geometry
    //
    // The numbers live in `HakkaMetrics` (generated from the same scale RN, web
    // and Android use — see DESIGN.md "One geometry"), never here. The `sN`
    // spellings below are the legacy value-named aliases: 458 call sites use
    // them, and a name like `s16` says how big the gap is but not what it is,
    // which is exactly why the page edge drifted across screens. Prefer
    // `HakkaMetrics.Layout.gutter` for a page edge and
    // `HakkaMetrics.ControlHeight.*` for anything interactive; reach for `sN`
    // only when touching code that already uses it.

    static let s2 = HakkaMetrics.Spacing.xxs
    static let s4 = HakkaMetrics.Spacing.xs
    static let s6 = HakkaMetrics.Spacing.sm
    static let s8 = HakkaMetrics.Spacing.md
    static let s10 = HakkaMetrics.Spacing.ml
    static let s12 = HakkaMetrics.Spacing.lg
    static let s14 = HakkaMetrics.Spacing.ll
    static let s16 = HakkaMetrics.Spacing.xl
    static let s20 = HakkaMetrics.Spacing.xxl

    /// Detail-pane side inset — reduced from the full gutter on phones so
    /// content (key/value tables, cards) reclaims width instead of losing it to
    /// symmetric margins on both sides.
    static let panePadH = HakkaMetrics.Layout.cardPadding

    // MARK: - Radii
    //
    // One radius rule (DESIGN.md): interactive controls (buttons, chips, inputs,
    // selects, seg tracks) are `radiusM` (6px). `radiusS` (4px) is only for tiny
    // nested elements (segments inside a track, method badges inside rows).
    // Pills (fully-rounded) are only for non-interactive badges/tags/counts.
    // Containers use `radiusL`/`radiusXL`.

    static let radiusS: CGFloat = 4
    static let radiusM: CGFloat = 6
    static let radiusL: CGFloat = 10
    static let radiusXL: CGFloat = 14

    // MARK: - Icon Sizes

    static let iconXS: CGFloat = 8
    static let iconS: CGFloat = 9

    // MARK: - Row

    static let rowPadH = HakkaMetrics.Spacing.ll
    static let rowPadV = HakkaMetrics.Spacing.ml

    /// Two-line list row baseline height — the height at the default Dynamic
    /// Type size, used as a *minimum* so rows grow rather than clip under
    /// larger accessibility text sizes. Applies to the request list row;
    /// other row shapes (Storage's variable-length values, Breakpoints'
    /// cards) aren't clamped to this at all.
    static let rowH: CGFloat = 64

    // MARK: - Control Heights
    //
    // One height rule (DESIGN.md): chips use `ctlH`; action-bar controls
    // use `ctlHLg`; the minimum touch target for any control — including ones
    // whose visual glyph is smaller — is `tapMin`, via padding, never by
    // shrinking the tap zone itself.

    static let ctlH = HakkaMetrics.ControlHeight.chip
    static let ctlHLg = HakkaMetrics.ControlHeight.md
    static let tapMin = HakkaMetrics.ControlHeight.bar

    // MARK: - Functions

    static func statusColor(for code: Int?) -> Color {
        guard let code else { return pending }
        switch code {
        case 200..<300: return success
        case 300..<400: return warning
        case 400..<600: return error
        default: return pending
        }
    }

    static func methodColor(for method: HttpMethod) -> Color {
        switch method {
        case .get: return methodGet
        case .post: return methodPost
        case .put: return methodPut
        case .patch: return methodPatch
        case .delete: return methodDelete
        case .head, .options: return pending
        }
    }
}

// MARK: - Liquid Glass Helpers

extension View {
    /// Shared page canvas for the phone inspector. The grouped background gives
    /// cards separation without turning each destination into a custom chrome.
    func hakkaPageCanvas() -> some View {
        self
            .background(Theme.bg.ignoresSafeArea())
            .tint(Theme.accent)
    }

    /// The standard grouped surface used for content cards, forms, and rows.
    /// It deliberately keeps the existing flame accent available for state and
    /// actions rather than using it as a decorative background color.
    func hakkaGroupedCard(
        padding: CGFloat = Theme.s12,
        cornerRadius: CGFloat = Theme.radiusXL
    ) -> some View {
        self
            .padding(padding)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Theme.border.opacity(0.55), lineWidth: 0.5)
            }
    }

    /// Keeps small glyphs visually compact while every action receives a
    /// predictable 44-point hit target.
    func hakkaIconTarget() -> some View {
        self.frame(minWidth: Theme.tapMin, minHeight: Theme.tapMin)
    }

    @ViewBuilder
    func hakkaGlassSurface(
        tint: Color = Theme.chromeTint,
        cornerRadius: CGFloat = Theme.radiusXL,
        interactive: Bool = false
    ) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if #available(iOS 26.0, *) {
            if interactive {
                self.glassEffect(.regular.tint(tint).interactive(), in: shape)
            } else {
                self.glassEffect(.regular.tint(tint), in: shape)
            }
        } else {
            self
                .background(.ultraThinMaterial, in: shape)
                .overlay(shape.stroke(Theme.border.opacity(0.55), lineWidth: 0.5))
        }
    }

    @ViewBuilder
    func hakkaControlGlass(cornerRadius: CGFloat = Theme.radiusL) -> some View {
        self.hakkaGlassSurface(
            tint: Theme.controlTint,
            cornerRadius: cornerRadius,
            interactive: true
        )
    }

    /// Standard detail-pane content padding — reduced side inset (`panePadH`),
    /// full vertical inset (`s16`). Use for tab content wrappers (Overview,
    /// Request, Response, GraphQL, Frames, Timing) instead of a flat
    /// `.padding(Theme.s16)` so phones get their width back on the sides.
    func hakkaPaneContent() -> some View {
        self
            .padding(.horizontal, Theme.panePadH)
            .padding(.vertical, Theme.s16)
    }

    /// Shared inspector toolbar chrome. All inspector destinations use the
    /// same page edge, vertical rhythm, and surface treatment.
    func hakkaInspectorToolbar() -> some View {
        self
            .padding(.horizontal, HakkaMetrics.Layout.gutter)
            .padding(.top, HakkaMetrics.Spacing.ml)
            .padding(.bottom, HakkaMetrics.Spacing.sm)
            .background(Theme.surfaceRaised)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Theme.border.opacity(0.55)).frame(height: 0.5) // ui-token-check-ignore: separator rail geometry
            }
    }
}

#endif
