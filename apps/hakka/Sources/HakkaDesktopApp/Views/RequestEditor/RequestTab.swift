/// The six request-editor tabs, left to right per the app spec.
enum RequestTab: String, CaseIterable, Identifiable {
    case params = "Params"
    case headers = "Headers"
    case body = "Body"
    case auth = "Auth"
    case tests = "Tests"
    case docs = "Docs"

    var id: String { rawValue }
}
