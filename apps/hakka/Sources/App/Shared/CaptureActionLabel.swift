import SwiftUI

/// Gives workspace and inspector actions a shared label height and inset.
struct CaptureActionLabel: View {
    let title: String
    let systemImage: String?
    var showsMenuIndicator = false
    var isProminent = false

    init(_ title: String, systemImage: String? = nil, showsMenuIndicator: Bool = false, isProminent: Bool = false) {
        self.title = title
        self.systemImage = systemImage
        self.showsMenuIndicator = showsMenuIndicator
        self.isProminent = isProminent
    }

    var body: some View {
        HStack(spacing: Spacing.sm) {
            if let systemImage {
                Label(title, systemImage: systemImage)
            } else {
                Text(title)
            }
            if showsMenuIndicator {
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
        }
        .font(.system(size: FontSize.md, weight: .medium))
        .padding(.horizontal, isProminent ? Spacing.xs : 0)
        .frame(minHeight: isProminent ? ControlHeight.icon : ControlHeight.icon - Spacing.sm)
        .foregroundStyle(isProminent ? AnyShapeStyle(ThemeTokens.Status.onWarm) : AnyShapeStyle(.primary))
    }
}
