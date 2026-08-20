import Foundation
import HakkaCommon

/// Imports a copy-pasted `curl` command into a `RequestSpec`. Covers the
/// flags real "copy as cURL" exports use: `-X`, `-H`, the `-d` family,
/// `--form`, `-u`, `--url`, `-b`/`-A`/`-e` (which become headers), plus
/// quoting and `\`-continued lines.
///
/// Flags that take a value but that we don't model are listed in
/// `skippedValueFlags` so their value is consumed rather than left looking
/// like a bare token. That mattered more than it sounds: a bare token before
/// the URL used to *become* the URL, so `curl -b 'session=abc' https://api…`
/// imported with the url `session=abc` and the real one discarded. As a second
/// line of defence the URL is chosen by what actually looks like a URL, so an
/// unlisted value-taking flag degrades to a missing header rather than a
/// broken request.
public enum CurlImporter {
    /// Consume the next token, model nothing. Not exhaustive — curl has
    /// hundreds of flags — which is why `looksLikeURL` backs it up.
    private static let skippedValueFlags: Set<String> = [
        "-o", "--output", "-w", "--write-out", "-m", "--max-time", "--connect-timeout",
        "-c", "--cookie-jar", "-E", "--cert", "--key", "--cacert", "--capath",
        "-T", "--upload-file", "--retry", "--retry-delay", "--retry-max-time",
        "--limit-rate", "-r", "--range", "--resolve", "--interface", "-D", "--dump-header",
        "--proto", "-Y", "--speed-limit", "-y", "--speed-time", "--max-filesize",
        "--local-port", "--noproxy", "--proxy-user", "-x", "--proxy", "--unix-socket",
        "--tlsv1", "--tls-max", "--engine", "--krb", "--delegation",
    ]
    public static func parse(_ command: String) throws(ImportError) -> RequestSpec {
        let joined = ShellTokenizer.joinLineContinuations(command)
        let tokens = ShellTokenizer.tokenize(joined)
        guard let curlIndex = tokens.firstIndex(where: { $0.caseInsensitiveCompare("curl") == .orderedSame }) else {
            throw ImportError.missingField("curl")
        }

        var method: HttpMethod?
        var headers: [HeaderPair] = []
        var rawURL: String?
        var urlCandidate: String?
        var bareToken: String?
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
            case "-d", "--data", "--data-raw", "--data-binary", "--data-ascii":
                idx += 1
                guard idx < tokens.count else { throw ImportError.missingField("-d") }
                bodyParts.append(tokens[idx])
            case "--data-urlencode":
                idx += 1
                guard idx < tokens.count else { throw ImportError.missingField("--data-urlencode") }
                bodyParts.append(Self.urlEncodedDataPart(tokens[idx]))
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
            // curl models these as dedicated flags; on the wire they are just
            // headers, which is how Hakka stores them.
            case "-b", "--cookie":
                idx += 1
                guard idx < tokens.count else { throw ImportError.missingField("-b") }
                headers.append(HeaderPair(name: "Cookie", value: tokens[idx]))
            case "-A", "--user-agent":
                idx += 1
                guard idx < tokens.count else { throw ImportError.missingField("-A") }
                headers.append(HeaderPair(name: "User-Agent", value: tokens[idx]))
            case "-e", "--referer":
                idx += 1
                guard idx < tokens.count else { throw ImportError.missingField("-e") }
                headers.append(HeaderPair(name: "Referer", value: tokens[idx]))
            case "--oauth2-bearer":
                idx += 1
                guard idx < tokens.count else { throw ImportError.missingField("--oauth2-bearer") }
                auth = .oauth2(accessToken: tokens[idx])
            default:
                if Self.skippedValueFlags.contains(token) {
                    idx += 1 // consume the value so it can't be read as the URL
                } else if !token.hasPrefix("-") {
                    if Self.looksLikeURL(token) {
                        if urlCandidate == nil { urlCandidate = token }
                    } else if bareToken == nil {
                        bareToken = token
                    }
                }
            }
            idx += 1
        }

        guard let rawURL = rawURL ?? urlCandidate ?? bareToken else { throw ImportError.missingField("url") }
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

    /// Does this bare token read as a URL rather than as some flag's orphaned
    /// value? Covers the three shapes that show up in real commands: an
    /// explicit scheme, a dotted host, and `host:port`.
    private static func looksLikeURL(_ token: String) -> Bool {
        if token.contains("://") { return true }
        let host = token.prefix { $0 != "/" }
        if host.contains("=") { return false }
        if host.contains(".") { return true }
        guard let colon = host.lastIndex(of: ":"), colon != host.startIndex else { return false }
        let port = host[host.index(after: colon)...]
        return !port.isEmpty && port.allSatisfy(\.isNumber)
    }

    /// curl's `--data-urlencode`, which percent-encodes where plain `-d` does
    /// not. `name=content` encodes only the content and keeps the key; a bare
    /// `content` or `=content` encodes the whole value. The `@file` forms read
    /// from disk, which an importer given only a command string cannot do, so
    /// they pass through untouched.
    private static func urlEncodedDataPart(_ raw: String) -> String {
        if raw.hasPrefix("@") || raw.contains("@") && !raw.contains("=") { return raw }
        if raw.hasPrefix("=") { return Self.percentEncoded(String(raw.dropFirst())) }
        guard let eq = raw.firstIndex(of: "=") else { return Self.percentEncoded(raw) }
        let name = raw[raw.startIndex ..< eq]
        let value = String(raw[raw.index(after: eq)...])
        return "\(name)=\(Self.percentEncoded(value))"
    }

    /// `application/x-www-form-urlencoded` encoding: unreserved characters
    /// survive, everything else is percent-escaped. `.urlQueryAllowed` is too
    /// permissive here — it keeps `&` and `=`, which would let one value forge
    /// extra form fields.
    private static func percentEncoded(_ value: String) -> String {
        let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? value
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
