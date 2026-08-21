/// The request-editor tabs, left to right per the app spec. `scripts` is
/// ADR 0010 phase 4.4 — pre-request/post-response hooks, added after
/// `tests` (the closest existing sibling: both edit behavior that runs
/// around a send rather than the request's own shape) and before `docs`.
enum RequestTab: String, CaseIterable, Identifiable {
    case params = "Params"
    case headers = "Headers"
    case body = "Body"
    case auth = "Auth"
    case tests = "Tests"
    case scripts = "Scripts"
    case docs = "Docs"

    var id: String { rawValue }
}
