import Foundation
import HakkaCommon

/// Imports a copy-pasted `curl` command into a `RequestSpec`. Covers the
/// flags real "copy as cURL" exports use: `-X`, `-H`, the `-d` family,
/// `--form`, `-u`, `--url`, plus quoting and `\`-continued lines. Any other
/// flag is treated as boolean and skipped — an unrecognized flag that also
/// takes a value will mis-parse (its value token gets treated as the next
/// flag or, if bare, as the URL); that's a known gap for exotic curl usage,
/// not a silent data-loss risk.
public enum CurlImporter {
    public static func parse(_ command: String) throws(ImportError) -> RequestSpec {
        let joined = ShellTokenizer.joinLineContinuations(command)
        let tokens = ShellTokenizer.tokenize(joined)
        guard let curlIndex = tokens.firstIndex(where: { $0.caseInsensitiveCompare("curl") == .orderedSame }) else {
            throw ImportError.missingField("curl")
        }

        var method: HttpMethod?
        var headers: [HeaderPair] = []
        var rawURL: String?
        var bodyParts: [String] = []
        var multipartParts: [MultipartPart] = []
        var auth: AuthSpec = .none
        var isMultipart = false

        var idx = tokens.index(after: curlIndex)
        while idx < tokens.count {
            let token = tokens[idx]
            switch token {
            case "-X", "--request":
                idx += 1
                guard idx < tokens.count else { throw ImportError.missingField("-X") }
                method = HttpMethod(rawString: tokens[idx])
            case "-H", "--header":
                idx += 1
                guard idx < tokens.count else { throw ImportError.missingField("-H") }
                if let pair = Self.splitHeader(tokens[idx]) { headers.append(pair) }
            case "-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode":
                idx += 1
                guard idx < tokens.count else { throw ImportError.missingField("-d") }
                bodyParts.append(tokens[idx])
            case "-F", "--form":
                idx += 1
                guard idx < tokens.count else { throw ImportError.missingField("-F") }
                isMultipart = true
                multipartParts.append(Self.parseFormPart(tokens[idx]))
            case "-u", "--user":
                idx += 1
                guard idx < tokens.count else { throw ImportError.missingField("-u") }
                auth = Self.parseBasicAuth(tokens[idx])
            case "--url":
                idx += 1
                guard idx < tokens.count else { throw ImportError.missingField("--url") }
                rawURL = tokens[idx]
            default:
                if !token.hasPrefix("-"), rawURL == nil {
                    rawURL = token
                }
            }
            idx += 1
        }

        guard let rawURL else { throw ImportError.missingField("url") }
        let (base, queryItems) = URLQuerySplitter.split(rawURL)
        let query = queryItems.map { HeaderPair(name: $0.name, value: $0.value) }

        let body: BodySpec = if isMultipart {
            .multipart(multipartParts)
        } else if !bodyParts.isEmpty {
            .raw(text: bodyParts.joined(separator: "&"), contentType: Self.headerValue(headers, "Content-Type") ?? "application/x-www-form-urlencoded")
        } else {
            .none
        }

        let resolvedMethod = method ?? (isMultipart || !bodyParts.isEmpty ? .post : .get)
        return RequestSpec(name: "Imported cURL request", method: resolvedMethod, url: base, headers: headers, query: query, body: body, auth: auth)
    }

    private static func splitHeader(_ raw: String) -> HeaderPair? {
        guard let colon = raw.firstIndex(of: ":") else { return nil }
        let name = raw[raw.startIndex ..< colon].trimmingCharacters(in: .whitespaces)
        let value = raw[raw.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return nil }
        return HeaderPair(name: name, value: value)
    }

    private static func parseFormPart(_ raw: String) -> MultipartPart {
        guard let eq = raw.firstIndex(of: "=") else { return MultipartPart(name: raw, value: "") }
        let name = String(raw[raw.startIndex ..< eq])
        var rest = String(raw[raw.index(after: eq)...])
        guard rest.hasPrefix("@") else { return MultipartPart(name: name, value: rest) }
        rest.removeFirst()
        if let typeRange = rest.range(of: ";type=") {
            let path = String(rest[rest.startIndex ..< typeRange.lowerBound])
            let contentType = String(rest[typeRange.upperBound...])
            return MultipartPart(name: name, filePath: path, contentType: contentType)
        }
        return MultipartPart(name: name, filePath: rest)
    }

    private static func parseBasicAuth(_ raw: String) -> AuthSpec {
        guard let colon = raw.firstIndex(of: ":") else { return .basic(username: raw, password: "") }
        let user = String(raw[raw.startIndex ..< colon])
        let pass = String(raw[raw.index(after: colon)...])
        return .basic(username: user, password: pass)
    }

    private static func headerValue(_ headers: [HeaderPair], _ name: String) -> String? {
        headers.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }?.value
    }
}
