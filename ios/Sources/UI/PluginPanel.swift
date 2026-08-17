#if canImport(UIKit)
import SwiftUI
import HakkaCommon

// MARK: - HakkaPanel + SwiftUI convenience

public extension HakkaPanel {
    /// Typed view builder. Returns `nil` when no builder was registered or the
    /// stored value is not a SwiftUI view factory.
    var viewBuilder: (() -> AnyView)? {
        _viewBuilderErased as? () -> AnyView
    }

    /// Create a panel carrying a SwiftUI view builder.
    ///
    /// Usage inside a `HakkaPlugin.panels` implementation:
    /// ```swift
    /// HakkaPanel(id: "analytics", title: "Analytics", icon: "chart.bar") {
    ///     AnyView(AnalyticsView())
    /// }
    /// ```
    init(
        id: String,
        title: String,
        order: Int = 100,
        icon: String = "puzzlepiece",
        @ViewBuilder content: @escaping () -> some View
    ) {
        let builder: () -> AnyView = { AnyView(content()) }
        self.init(id: id, title: title, order: order, icon: icon, _erased: builder)
    }
}
#endif // canImport(UIKit)
