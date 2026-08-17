#if canImport(SwiftUI)
import SwiftUI

public struct AppIcon: View {
    public init() {}

    public var body: some View {
        TimelineView(.animation) { timeline in
            let phase = timeline.date.timeIntervalSinceReferenceDate
            Canvas { context, size in
                drawIcon(in: context, size: size, phase: phase)
            }
            .accessibilityLabel("Hakka animated icon")
        }
        .aspectRatio(1, contentMode: .fit)
    }

    private func drawIcon(in context: GraphicsContext, size: CGSize, phase: TimeInterval) {
        let side = min(size.width, size.height)
        let origin = CGPoint(x: (size.width - side) / 2, y: (size.height - side) / 2)
        let rect = CGRect(origin: origin, size: CGSize(width: side, height: side))
        let s = side / 64
        let pulse = 0.5 + 0.5 * sin(phase * 2.0)

        for index in 0..<3 {
            let radius = (7 + CGFloat(index) * 6 + CGFloat(pulse) * 4) * s
            var arc = Path()
            arc.addArc(
                center: CGPoint(x: rect.midX, y: rect.minY + side * 0.38),
                radius: radius,
                startAngle: .degrees(200),
                endAngle: .degrees(340),
                clockwise: false
            )
            context.stroke(arc, with: .color(Color(red: 0.13, green: 0.83, blue: 0.93).opacity(0.9 - Double(index) * 0.22)), style: StrokeStyle(lineWidth: 1.7 * s, lineCap: .round))
        }

        var stickA = Path()
        stickA.move(to: CGPoint(x: rect.minX + side * 0.65, y: rect.minY + side * 0.39))
        stickA.addLine(to: CGPoint(x: rect.minX + side * 0.79, y: rect.minY + side * 0.18))
        context.stroke(stickA, with: .color(.white.opacity(0.62)), style: StrokeStyle(lineWidth: 2 * s, lineCap: .round))

        var stickB = Path()
        stickB.move(to: CGPoint(x: rect.minX + side * 0.72, y: rect.minY + side * 0.41))
        stickB.addLine(to: CGPoint(x: rect.minX + side * 0.84, y: rect.minY + side * 0.27))
        context.stroke(stickB, with: .color(.white.opacity(0.62)), style: StrokeStyle(lineWidth: 2 * s, lineCap: .round))

        let bowl = CGRect(x: rect.minX + side * 0.12, y: rect.minY + side * 0.40, width: side * 0.76, height: side * 0.44)
        context.fill(Path(ellipseIn: bowl), with: .linearGradient(
            Gradient(colors: [Color(red: 0.38, green: 0.65, blue: 0.98), Color(red: 0.15, green: 0.39, blue: 0.92)]),
            startPoint: CGPoint(x: bowl.midX, y: bowl.minY),
            endPoint: CGPoint(x: bowl.midX, y: bowl.maxY)
        ))

        var rim = Path()
        rim.move(to: CGPoint(x: rect.minX + side * 0.10, y: rect.minY + side * 0.42))
        rim.addLine(to: CGPoint(x: rect.minX + side * 0.90, y: rect.minY + side * 0.42))
        context.stroke(rim, with: .color(Color(red: 0.58, green: 0.77, blue: 0.99)), style: StrokeStyle(lineWidth: 3.2 * s, lineCap: .round))
    }
}
#endif
