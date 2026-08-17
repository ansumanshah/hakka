#if canImport(UIKit)
import SwiftUI
import HakkaCommon
import HakkaNetwork
import HakkaPerformance

// MARK: - DashboardView: Shared row/card builders
//
// Small view builders reused across the section files above.

extension DashboardView {
    func label(_ title: String) -> some View {
        Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text)
    }

    func card(_ title: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: Theme.s6) {
            Text(value)
                .font(.title3.monospacedDigit().weight(.bold))
                .foregroundStyle(color)
            Text(title)
                .font(.caption)
                .foregroundStyle(Theme.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.s12)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusL))
    }

    func hudLane(_ title: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: Theme.s4) {
            Text(value)
                .font(.title3.monospacedDigit().weight(.bold))
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Text(title)
                .font(.caption2.weight(.heavy))
                .foregroundStyle(Theme.textTertiary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 50)  // ui-token-check-ignore: chart bar or plot-area geometry
    }
}
#endif // canImport(UIKit)
