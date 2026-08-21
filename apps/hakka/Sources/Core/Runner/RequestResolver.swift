import Foundation
import HakkaCommon

/// Turns a `RequestSpec` plus its inherited context into a `ResolvedRequest`
/// the runner can send verbatim.
///
/// Header precedence is collection defaults < folder headers (outer to
/// inner) < the request's own — later levels overwrite a same-named header
/// from an earlier level rather than adding a duplicate. Auth precedence
/// walks the opposite direction: the nearest non-`.inherit` `AuthSpec`
/// starting at the request and going *up* through the folder chain to the
/// collection wins, since `.inherit` means "keep asking my parent."
public enum RequestResolver {
    public static func resolve(
        _ request: RequestSpec,
        folderChain: [Folder] = [],
        collection: Collection,
        scope: VariableScope,
    ) throws(RequestResolutionError) -> ResolvedRequest {
        var missing: [String] = []

        let urlInterpolation = VariableInterpolator.interpolate(request.url, scope: scope)
        missing.append(contentsOf: urlInterpolation.missing)
        let (base, urlQueryItems) = URLQuerySplitter.split(urlInterpolation.text)

        var headers: HeaderList = []
        apply(collection.defaultHeaders, to: &headers, scope: scope, missing: &missing)
        for folder in folderChain {
            apply(folder.headers, to: &headers, scope: scope, missing: &missing)
        }
        apply(request.headers, to: &headers, scope: scope, missing: &missing)

        var query = urlQueryItems
        for pair in request.query where pair.enabled {
            let name = interpolate(pair.name, scope: scope, missing: &missing)
            let value = interpolate(pair.value, scope: scope, missing: &missing)
            setQuery(name, value, in: &query)
        }

        let auth = effectiveAuth(request: request.auth, folderChain: folderChain, collectionAuth: collection.auth)
        applyAuth(auth, headers: &headers, query: &query, scope: scope, missing: &missing)

        let body = interpolateBody(request.body, scope: scope, missing: &missing)
        // A multipart body's real Content-Type carries a boundary that only
        // exists once `RequestBodyEncoder` encodes the body at send time, so
        // resolution leaves that header for `RequestRunner` to fill in rather
        // than inserting a boundary-less placeholder here (see `EffectiveRequest`
        // for the same split).
        let isMultipartBody = if case .multipart = body { true } else { false }
        // Precedence: an explicit header the user typed always wins over the
        // body kind's implied Content-Type — `hasHeader` gates this entirely,
        // so a body-derived value is only appended when no such header
        // exists yet. This direction, not the reverse, is what lets picking
        // a body kind act as a *default* (raw JSON, form-urlencoded, a
        // GraphQL request) without silently clobbering a Content-Type a user
        // set on purpose, e.g. to send JSON with a nonstandard `+json` suffix.
        if !isMultipartBody, let contentType = body.contentTypeHeader, !hasHeader("Content-Type", in: headers) {
            headers.append((name: "Content-Type", value: contentType))
        }

        guard missing.isEmpty else {
            throw .missingVariables(uniqueOrdered(missing))
        }

        let finalURLString = URLQuerySplitter.join(base: base, items: query)
        guard let url = URL(string: finalURLString) else {
            throw .invalidURL(finalURLString)
        }

        return ResolvedRequest(
            requestId: request.id,
            name: request.name,
            method: request.method,
            url: url,
            headers: Dictionary(headers.map { ($0.name, $0.value) }, uniquingKeysWith: { _, last in last }),
            body: body,
            timeout: request.timeout,
            followRedirects: request.followRedirects,
        )
    }

    // MARK: - Header/query merge

    typealias HeaderList = [(name: String, value: String)]

    private static func apply(_ pairs: [HeaderPair], to headers: inout HeaderList, scope: VariableScope, missing: inout [String]) {
        for pair in pairs where pair.enabled {
            let name = interpolate(pair.name, scope: scope, missing: &missing)
            let value = interpolate(pair.value, scope: scope, missing: &missing)
            setHeader(name, value, in: &headers)
        }
    }

    static func setHeader(_ name: String, _ value: String, in headers: inout HeaderList) {
        headers.removeAll { $0.name.caseInsensitiveCompare(name) == .orderedSame }
        headers.append((name, value))
    }

    private static func hasHeader(_ name: String, in headers: HeaderList) -> Bool {
        headers.contains { $0.name.caseInsensitiveCompare(name) == .orderedSame }
    }

    static func setQuery(_ name: String, _ value: String, in items: inout [(name: String, value: String)]) {
        if let index = items.firstIndex(where: { $0.name == name }) {
            items[index].value = value
        } else {
            items.append((name, value))
        }
    }

    // MARK: - Body

    private static func interpolateBody(_ body: BodySpec, scope: VariableScope, missing: inout [String]) -> BodySpec {
        switch body {
        case .none:
            .none
        case let .raw(text, contentType):
            .raw(text: interpolate(text, scope: scope, missing: &missing), contentType: contentType)
        case let .form(pairs):
            .form(pairs.filter(\.enabled).map {
                HeaderPair(
                    id: $0.id,
                    name: interpolate($0.name, scope: scope, missing: &missing),
                    value: interpolate($0.value, scope: scope, missing: &missing),
                )
            })
        case let .multipart(parts):
            .multipart(parts.filter(\.enabled).map {
                MultipartPart(
                    id: $0.id,
                    name: interpolate($0.name, scope: scope, missing: &missing),
                    value: interpolate($0.value, scope: scope, missing: &missing),
                    filePath: $0.filePath.map { interpolate($0, scope: scope, missing: &missing) },
                    contentType: $0.contentType,
                )
            })
        case let .graphql(query, variables, operationName):
            // `operationName` is a literal choice from the parsed operation
            // list (picked in the editor), not user-typed template text, so
            // it isn't run through variable interpolation like the other
            // fields — there's nothing in it that could contain `{{...}}`.
            .graphql(
                query: interpolate(query, scope: scope, missing: &missing),
                variables: interpolate(variables, scope: scope, missing: &missing),
                operationName: operationName,
            )
        case let .file(path, contentType):
            .file(path: interpolate(path, scope: scope, missing: &missing), contentType: contentType)
        }
    }

    // MARK: - Shared

    static func interpolate(_ template: String, scope: VariableScope, missing: inout [String]) -> String {
        let result = VariableInterpolator.interpolate(template, scope: scope)
        missing.append(contentsOf: result.missing)
        return result.text
    }

    private static func uniqueOrdered(_ names: [String]) -> [String] {
        var seen = Set<String>()
        return names.filter { seen.insert($0).inserted }
    }
}
