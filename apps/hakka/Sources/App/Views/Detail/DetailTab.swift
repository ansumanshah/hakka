import HakkaCommon
import HakkaCore

/// The detail pane's tab grammar, mirroring the web inspector's `Detail.tsx`
/// tab union: Overview / Request / Response / Timing always, with the SSE
/// tab appended for `text/event-stream` responses. Request and Response each
/// carry their own headers above their body rather than sharing a Headers
/// tab.
enum DetailTab: String, CaseIterable, Identifiable {
    case overview = "Overview"
    case request = "Request"
    case response = "Response"
    case timing = "Timing"
    case sse = "SSE"
    case cookies = "Cookies"

    var id: String { rawValue }

    /// The tabs a given record shows: the base four, plus the SSE tab when
    /// the response content type names an event stream, plus the Cookies
    /// tab when the record actually carried one — most requests carry none,
    /// so the tab would just be an always-empty distraction.
    static func visible(for record: NetworkRequest) -> [DetailTab] {
        var tabs: [DetailTab] = [.overview, .request, .response, .timing]
        if SseEventParser.isEventStream(contentType: record.contentType) {
            tabs.append(.sse)
        }
        if CookieHeaderParser.hasCookies(requestHeaders: record.requestHeaders, responseHeaders: record.responseHeaders) {
            tabs.append(.cookies)
        }
        return tabs
    }
}
