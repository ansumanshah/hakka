#if canImport(UIKit)
import SwiftUI
import UIKit

// MARK: - ShareSheet

/// Wraps UIActivityViewController for sharing arbitrary items from SwiftUI.
/// Uses a wrapper VC to avoid the iPad crash where UIActivityViewController
/// requires a popoverPresentationController.sourceView.
struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]

    /// Convenience initializer for sharing a single text string.
    init(text: String) {
        self.activityItems = [text]
    }

    /// Share multiple items (e.g. text + file URLs).
    init(items: [Any]) {
        self.activityItems = items
    }

    func makeUIViewController(context: Context) -> UIViewController {
        // Wrapper that presents the activity VC after appearing (gives iPad time to set sourceView)
        let wrapper = ShareSheetWrapper()
        wrapper.activityItems = activityItems
        return wrapper
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

private class ShareSheetWrapper: UIViewController {
    var activityItems: [Any] = []
    private var presented = false

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !presented else { return }
        presented = true

        let avc = UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
        // iPad requires popover source — anchor to this view's bounds
        if let pop = avc.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
            pop.permittedArrowDirections = []
        }
        avc.completionWithItemsHandler = { [weak self] _, _, _, _ in
            self?.dismiss(animated: true)
        }
        present(avc, animated: true)
    }
}
#endif // canImport(UIKit)
