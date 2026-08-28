import SwiftUI

// MARK: - DemoEvent

struct DemoEvent: Identifiable {
    let id = UUID()
    let title: String
    let tint: Color
    let date = Date()

    var time: String {
        Self.formatter.string(from: date)
    }

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()
}

// MARK: - Reusable view builders
//
// Pure functions of their parameters -- no `DemoView` state -- but kept as
// `extension DemoView` (rather than free functions) so every scenario tab
// calls them the same way the original single-file version did.

extension DemoView {
    func statTile(_ title: String, _ value: String, _ icon: String, _ tint: Color, compact: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(tint)
                Text(title)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white.opacity(0.66))
                    .lineLimit(1)
            }
            Text(value)
                .font((compact ? Font.caption : Font.title3).monospacedDigit().weight(.heavy))
                .foregroundStyle(.white)
                .lineLimit(compact ? 2 : 1)
                .minimumScaleFactor(0.68)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 70)
        .padding(.horizontal, 12)
        .demoGlass(tint: tint.opacity(0.13), cornerRadius: 18, interactive: false)
    }

    func featureCard(_ title: String, _ subtitle: String, _ icon: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
                .demoGlass(tint: tint.opacity(0.16), cornerRadius: 9, interactive: false)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.white.opacity(0.68))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 96, alignment: .topLeading)
        .padding(12)
        .demoGlass(tint: tint.opacity(0.10), cornerRadius: 18, interactive: false)
    }

    func heroButton(
        _ title: String,
        _ icon: String,
        _ tint: Color,
        prominent: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
        }
        .demoGlassButton(tint: tint, prominent: prominent)
    }

    func commandSection<Content: View>(
        _ title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        glassGroup(cornerRadius: 22) {
            VStack(alignment: .leading, spacing: 11) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.white)
                    Text(subtitle)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white.opacity(0.68))
                        .lineLimit(2)
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 124), spacing: 8)], spacing: 8) {
                    content()
                }
            }
            .padding(14)
        }
    }

    func command(_ title: String, _ icon: String, _ tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 20)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(height: 42)
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .demoGlassButton(tint: tint)
    }
}
