#if canImport(UIKit)
import HakkaCommon
import HakkaNetwork
import SwiftUI
import UIKit

// MARK: - Body & Image Helpers
//
// Split across sibling files in this directory:
//   - DetailBodyHelpers.swift      — this file: RequestDetailView entry points
//   - DetailQueryParams.swift      — QueryParamsView, FormURLEncodedParamsView
//   - DetailBodyContentCard.swift  — BodyContentCard (the raw/tree body renderer)
//   - DetailBodyMatchHighlight.swift — MatchHighlightedBody

extension RequestDetailView {

    @ViewBuilder
    func bodySection(title: String, content: String, contentType: String? = nil, contentEncoding: String? = nil) -> some View {
        BodyContentCard(
            title: title,
            content: content,
            searchText: searchText,
            contentType: contentType,
            contentEncoding: contentEncoding,
            isFormURLEncoded: isFormURLEncoded(for: title)
        )
    }

    /// True when the request body is application/x-www-form-urlencoded.
    private func isFormURLEncoded(for title: String) -> Bool {
        guard title == "Request Body" else { return false }
        let ct = request.requestHeaders["content-type"]?.first
            ?? request.requestHeaders["Content-Type"]?.first
            ?? ""
        return ct.localizedCaseInsensitiveContains("application/x-www-form-urlencoded")
    }

    @ViewBuilder
    var queryParamsSection: some View {
        if let url = URL(string: request.url),
           let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
           let items = components.queryItems, !items.isEmpty
        {
            QueryParamsView(items: items, searchText: searchText)
        }
    }

    @ViewBuilder
    func imagePreview(contentType: String) -> some View {
        if let image = ImageDetection.decodeImage(from: request.responseBody) {
            VStack(alignment: .leading, spacing: Theme.s6) {
                HStack(spacing: Theme.s6) {
                    Image(systemName: "photo")
                        .foregroundStyle(Theme.info)
                        .font(.caption)
                    Text(contentType)
                        .font(.caption2.monospaced())
                        .foregroundStyle(Theme.textSecondary)
                }
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: 200, maxHeight: 200)  // ui-token-check-ignore: multi-line editor bounds — content box, not a control
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radiusM)
                            .stroke(Theme.border, lineWidth: 1)
                    )
            }
        } else {
            HStack(spacing: Theme.s6) {
                Image(systemName: "photo")
                    .foregroundStyle(Theme.info)
                    .font(.caption)
                Text(contentType)
                    .font(.caption2.monospaced())
                    .foregroundStyle(Theme.textSecondary)
                if request.responseBodySize > 0 {
                    Text("(\(Fmt.formatBytes(request.responseBodySize)))")
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
    }
}
#endif // canImport(UIKit)
