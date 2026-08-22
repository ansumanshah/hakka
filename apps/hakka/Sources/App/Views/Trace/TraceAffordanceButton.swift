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
        Group {
            if let trace, trace.isMultiTarget {
                Button {
                    showSheet = true
                } label: {
                    Label("Trace", systemImage: "point.3.connected.trianglepath.dotted")
                }
                .sheet(isPresented: $showSheet) {
                    TraceWaterfallView(trace: trace) { id in
                        traffic.selectedRequestID = id
                        showSheet = false
                    }
                    .frame(minWidth: 560, minHeight: 360)  // ui-token-check-ignore: sheet size
                }
            }
        }
        .task(id: requestID) {
            trace = await traffic.traceStore.trace(forRequestID: requestID)
        }
    }
}
