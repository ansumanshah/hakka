import AppKit
import Testing
@testable import HakkaApp

@Suite("Adaptive macOS colors")
struct ThemeTokensAdaptiveColorTests {
    @Test func syntaxColorsResolveToTheActiveAppearance() {
        let colors: [(NSColor, RGB, RGB)] = [
            (NSColor(ThemeTokens.Code.key), RGB(red: 0.3412, green: 0.3255, blue: 0.2902), RGB(red: 0.6588, green: 0.6353, blue: 0.5882)),
            (NSColor(ThemeTokens.Code.string), RGB(red: 0.7059, green: 0.3333, blue: 0.1647), RGB(red: 0.8706, green: 0.5529, blue: 0.4078)),
            (NSColor(ThemeTokens.Code.number), RGB(red: 0.1686, green: 0.4235, blue: 0.6902), RGB(red: 0.4980, green: 0.7020, blue: 0.9098)),
            (NSColor(ThemeTokens.Code.boolean), RGB(red: 0.5216, green: 0.2824, blue: 0.6706), RGB(red: 0.7529, green: 0.5608, blue: 0.8510)),
            (NSColor(ThemeTokens.Code.null), RGB(red: 0.5216, green: 0.2824, blue: 0.6706), RGB(red: 0.7529, green: 0.5608, blue: 0.8510)),
            (NSColor(ThemeTokens.Code.highlight), RGB(red: 0.9608, green: 0.8980, blue: 0.7529), RGB(red: 0.3020, green: 0.2392, blue: 0.0627)),
        ]

        for (color, expectedLight, expectedDark) in colors {
            let light = resolved(color, in: .aqua)
            let dark = resolved(color, in: .darkAqua)

            #expect(light == expectedLight)
            #expect(dark == expectedDark)
            #expect(light != dark)
        }
    }

    @Test func semanticTextColorsResolveToTheActiveAppearance() {
        let colors: [(NSColor, RGB, RGB)] = [
            (NSColor(ThemeTokens.Status.success), RGB(red: 0.0902, green: 0.4510, blue: 0.3098), RGB(red: 0.2275, green: 0.6627, blue: 0.5059)),
            (NSColor(ThemeTokens.Status.info), RGB(red: 0.1961, green: 0.3804, blue: 0.5608), RGB(red: 0.4275, green: 0.6078, blue: 0.7882)),
            (NSColor(ThemeTokens.Status.warning), RGB(red: 0.5020, green: 0.3765, blue: 0), RGB(red: 0.8510, green: 0.6471, blue: 0.0784)),
            (NSColor(ThemeTokens.Status.error), RGB(red: 0.6863, green: 0.1882, blue: 0.1647), RGB(red: 0.8863, green: 0.3333, blue: 0.2902)),
            (NSColor(ThemeTokens.Status.pending), RGB(red: 0.3843, green: 0.3686, blue: 0.3294), RGB(red: 0.5529, green: 0.5294, blue: 0.4706)),
            (NSColor(ThemeTokens.Method.get), RGB(red: 0.0902, green: 0.4510, blue: 0.3098), RGB(red: 0.2275, green: 0.6627, blue: 0.5059)),
            (NSColor(ThemeTokens.Method.post), RGB(red: 0.6314, green: 0.3098, blue: 0), RGB(red: 0.9333, green: 0.5137, blue: 0.1255)),
            (NSColor(ThemeTokens.Method.put), RGB(red: 0.1961, green: 0.3804, blue: 0.5608), RGB(red: 0.4275, green: 0.6078, blue: 0.7882)),
            (NSColor(ThemeTokens.Method.patch), RGB(red: 0.4588, green: 0.2510, blue: 0.5569), RGB(red: 0.6588, green: 0.4980, blue: 0.7686)),
            (NSColor(ThemeTokens.Method.delete), RGB(red: 0.6863, green: 0.1882, blue: 0.1647), RGB(red: 0.8863, green: 0.3333, blue: 0.2902)),
            (NSColor(ThemeTokens.Method.other), RGB(red: 0.3843, green: 0.3686, blue: 0.3294), RGB(red: 0.5529, green: 0.5294, blue: 0.4706)),
        ]

        for (color, expectedLight, expectedDark) in colors {
            #expect(resolved(color, in: .aqua) == expectedLight)
            #expect(resolved(color, in: .darkAqua) == expectedDark)
        }
    }

    @Test func semanticTextColorsMeetContrastOnLightContentSurfaces() {
        // `on` and `onWarm` are foreground colors on filled status controls,
        // so this checks only semantic colors used as text on content surfaces.
        let colors = [
            NSColor(ThemeTokens.Status.success), NSColor(ThemeTokens.Status.info),
            NSColor(ThemeTokens.Status.warning), NSColor(ThemeTokens.Status.error),
            NSColor(ThemeTokens.Status.pending), NSColor(ThemeTokens.Method.get),
            NSColor(ThemeTokens.Method.post), NSColor(ThemeTokens.Method.put),
            NSColor(ThemeTokens.Method.patch), NSColor(ThemeTokens.Method.delete),
            NSColor(ThemeTokens.Method.other),
        ]
        let backgrounds = [
            RGB(hex: 0xFFFFFF), RGB(hex: 0xFAF8F4), RGB(hex: 0xF2EFE8),
        ]

        for color in colors {
            let foreground = resolved(color, in: .aqua)
            for background in backgrounds {
                #expect(foreground.contrastRatio(against: background) >= 4.5)
            }
        }
    }

    private func resolved(_ color: NSColor, in appearanceName: NSAppearance.Name) -> RGB {
        let appearance = NSAppearance(named: appearanceName)!
        var components: NSColor?
        appearance.performAsCurrentDrawingAppearance {
            components = color.usingColorSpace(.sRGB)
        }
        let resolved = components!
        return RGB(red: resolved.redComponent, green: resolved.greenComponent, blue: resolved.blueComponent)
    }
}

private struct RGB: Equatable {
    let red: CGFloat
    let green: CGFloat
    let blue: CGFloat

    init(red: CGFloat, green: CGFloat, blue: CGFloat) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    static func == (lhs: RGB, rhs: RGB) -> Bool {
        abs(lhs.red - rhs.red) < 0.0001 &&
            abs(lhs.green - rhs.green) < 0.0001 &&
            abs(lhs.blue - rhs.blue) < 0.0001
    }

    init(hex: UInt32) {
        red = CGFloat((hex >> 16) & 0xFF) / 255
        green = CGFloat((hex >> 8) & 0xFF) / 255
        blue = CGFloat(hex & 0xFF) / 255
    }

    func contrastRatio(against background: RGB) -> CGFloat {
        let lighter = max(relativeLuminance, background.relativeLuminance)
        let darker = min(relativeLuminance, background.relativeLuminance)
        return (lighter + 0.05) / (darker + 0.05)
    }

    private var relativeLuminance: CGFloat {
        0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    private func linear(_ component: CGFloat) -> CGFloat {
        component <= 0.04045 ? component / 12.92 : pow((component + 0.055) / 1.055, 2.4)
    }
}
