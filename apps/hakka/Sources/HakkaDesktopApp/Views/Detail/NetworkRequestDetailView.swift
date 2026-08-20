import HakkaCommon
import SwiftUI

/// Generic detail for any `NetworkRequest` — used for both a run's response
/// (`RunResult.record`) and a selected captured traffic row, since both are
/// the same record type.
struct NetworkRequestDetailView: View {
    let record: NetworkRequest

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            DetailOverviewSection(record: record)
            DetailHeadersSection(record: record)
            DetailBodySection(record: record)
        }
    }
}
