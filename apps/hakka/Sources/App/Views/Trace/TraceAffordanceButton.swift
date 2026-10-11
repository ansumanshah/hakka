import HakkaCore
import SwiftUI

/// The reachability affordance ADR 0001 needs: a captured request that
/// belongs to a multi-target trace gets a button to open its waterfall.
/// Self-contained (owns its own lookup + sheet) precisely so the call site
/// in `DetailPaneView` stays a single line — that file is edited by several
/// agents concurrently, so this view carries all the trace-specific state.
struct TraceAffordanceButton: View {
    let traffic: TrafficModel
    let requestID: String

    @State private var trace: Trace?
    @State private var showSheet = false

    var body: some View {
        HStack(spacing: 0) {
            if trace?.isMultiTarget == true {
                Button {
                    showSheet = true
                } label: {
                    CaptureActionLabel("Trace", systemImage: "point.3.connected.trianglepath.dotted", isProminent: false)
                }
                .captureGlassButtonStyle()
            }
        }
        .sheet(isPresented: $showSheet) {
            if let trace {
                VStack(spacing: 0) {
                    HStack(spacing: Spacing.md) {
                        Text("Trace")
                            .font(.headline)
                        Spacer()
                        Button("Done") { showSheet = false }
                            .keyboardShortcut(.cancelAction)
                    }
                    .padding(Spacing.lg)
                    Divider()
                    TraceWaterfallView(trace: trace) { id in
                        traffic.selectedRequestID = id
                        showSheet = false
                    }
                }
                .frame(minWidth: 560, minHeight: 360)  // ui-token-check-ignore: sheet size
            }
        }
        .task(id: requestID) {
            trace = nil
            let updates = await traffic.traceStore.subscribeTrace(forRequestID: requestID)
            for await update in updates {
                guard !Task.isCancelled else { break }
                trace = update
                if update == nil { showSheet = false }
            }
        }
    }
}
