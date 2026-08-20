import Foundation
import Testing

@testable import HakkaDesktopCore

/// Silent-data-loss paths in the importers, found by auditing ADR 0008's
/// "built" claim for the import row. None of these crashed; each one produced
/// a plausible-looking request with something quietly wrong or missing.
@Suite("import fidelity")
struct ImportFidelityTests {
    // MARK: - cURL

    /// `-b` is not in the recognized-flag list, so its value used to be read as
    /// a bare token — and a bare token before the URL became the URL. The real
    /// URL was then discarded as "already have one".
    @Test("a value-taking flag before the url does not become the url")
    func cookieFlagDoesNotEatTheURL() throws {
        let spec = try CurlImporter.parse("curl -b 'session=abc123' https://api.example.com/orders")

        #expect(spec.url == "https://api.example.com/orders")
        #expect(spec.headers.contains { $0.name == "Cookie" && $0.value == "session=abc123" })
    }

    @Test("an unmodelled value-taking flag does not corrupt the url")
    func outputFlagDoesNotEatTheURL() throws {
        let spec = try CurlImporter.parse("curl -o /tmp/out.json https://api.example.com/orders")

        #expect(spec.url == "https://api.example.com/orders")
    }

    /// The backstop for flags not on the list: pick the token that reads like a
    /// URL rather than the first bare one.
    @Test("an unlisted flag's value loses to something that looks like a url")
    func unknownFlagLosesToRealURL() throws {
        let spec = try CurlImporter.parse("curl --totally-unknown somevalue https://api.example.com/orders")

        #expect(spec.url == "https://api.example.com/orders")
    }

    @Test("host:port urls are still recognized")
    func hostPortURL() throws {
        let spec = try CurlImporter.parse("curl -b 'a=b' http://localhost:8080/health")

        #expect(spec.url == "http://localhost:8080/health")
    }

    @Test("user-agent and referer become headers")
    func userAgentAndReferer() throws {
        let spec = try CurlImporter.parse("curl -A 'hakka/1.0' -e 'https://ref.example.com' https://api.example.com/x")

        #expect(spec.headers.contains { $0.name == "User-Agent" && $0.value == "hakka/1.0" })
        #expect(spec.headers.contains { $0.name == "Referer" })
        #expect(spec.url == "https://api.example.com/x")
    }

    /// `--data-urlencode` percent-encodes where plain `-d` does not; passing it
    /// through raw let an unencoded `&` forge an extra form field.
    @Test("--data-urlencode encodes the value and keeps the key")
    func dataUrlencodeEncodes() throws {
        let spec = try CurlImporter.parse("curl --data-urlencode 'q=hello world&more' https://api.example.com/s")

        guard case let .raw(text, _) = spec.body else {
            Issue.record("expected a raw body")
            return
        }
        #expect(text == "q=hello%20world%26more")
    }

    @Test("--data-urlencode with no key encodes the whole value")
    func dataUrlencodeBare() throws {
        let spec = try CurlImporter.parse("curl --data-urlencode 'hello world' https://api.example.com/s")

        guard case let .raw(text, _) = spec.body else {
            Issue.record("expected a raw body")
            return
        }
        #expect(text == "hello%20world")
    }

    @Test("plain -d is still passed through verbatim")
    func plainDataIsVerbatim() throws {
        let spec = try CurlImporter.parse("curl -d '{\"a\":1}' https://api.example.com/s")

        guard case let .raw(text, _) = spec.body else {
            Issue.record("expected a raw body")
            return
        }
        #expect(text == "{\"a\":1}")
    }

    @Test("--oauth2-bearer becomes oauth2 auth")
    func oauth2Bearer() throws {
        let spec = try CurlImporter.parse("curl --oauth2-bearer tok123 https://api.example.com/me")

        guard case let .oauth2(token) = spec.auth else {
            Issue.record("expected oauth2 auth")
            return
        }
        #expect(token == "tok123")
    }

    // MARK: - Postman

    /// `AuthSpec.oauth2` exists and is wired through the runner and the UI;
    /// only the importer failed to map it, so the credential vanished.
    @Test("postman oauth2 auth is imported, not dropped")
    func postmanOAuth2() throws {
        let json = """
        {
          "info": {"name": "OAuth"},
          "item": [{
            "name": "Me",
            "request": {
              "method": "GET",
              "url": {"raw": "https://api.example.com/me"},
              "auth": {"type": "oauth2", "oauth2": [{"key": "accessToken", "value": "tok123"}]}
            }
          }]
        }
        """
        let collection = try PostmanImporter.parse(Data(json.utf8))

        guard case let .request(request) = collection.nodes.first, case let .oauth2(token) = request.auth else {
            Issue.record("expected an oauth2 request")
            return
        }
        #expect(token == "tok123")
    }

    @Test("postman formdata keeps a per-part content type")
    func postmanMultipartContentType() throws {
        let json = """
        {
          "info": {"name": "Upload"},
          "item": [{
            "name": "Upload",
            "request": {
              "method": "POST",
              "url": {"raw": "https://api.example.com/upload"},
              "body": {
                "mode": "formdata",
                "formdata": [{"key": "avatar", "value": "x", "contentType": "image/png"}]
              }
            }
          }]
        }
        """
        let collection = try PostmanImporter.parse(Data(json.utf8))

        guard case let .request(request) = collection.nodes.first, case let .multipart(parts) = request.body else {
            Issue.record("expected a multipart request")
            return
        }
        #expect(parts.first?.contentType == "image/png")
    }

    // MARK: - HAR

    /// HAR 1.2 allows a body as `params` instead of `text`; reading only `text`
    /// dropped those bodies with no error.
    @Test("a har body given as form params is reconstructed")
    func harFormParams() throws {
        let json = """
        {"log": {"entries": [{"request": {
          "method": "POST",
          "url": "https://api.example.com/login",
          "postData": {
            "mimeType": "application/x-www-form-urlencoded",
            "params": [{"name": "user", "value": "ada"}, {"name": "note", "value": "a&b"}]
          }
        }}]}}
        """
        let specs = try HarImporter.parse(Data(json.utf8))

        guard case let .raw(text, _) = specs.first?.body else {
            Issue.record("expected a raw body")
            return
        }
        #expect(text.contains("user=ada"))
        // The `&` inside a value must not read as a field separator.
        #expect(text.contains("note=a%26b"))
    }

    @Test("a har multipart body given as params becomes multipart")
    func harMultipartParams() throws {
        let json = """
        {"log": {"entries": [{"request": {
          "method": "POST",
          "url": "https://api.example.com/upload",
          "postData": {
            "mimeType": "multipart/form-data; boundary=xyz",
            "params": [{"name": "avatar", "fileName": "a.png", "contentType": "image/png"}]
          }
        }}]}}
        """
        let specs = try HarImporter.parse(Data(json.utf8))

        guard case let .multipart(parts) = specs.first?.body else {
            Issue.record("expected a multipart body")
            return
        }
        #expect(parts.first?.name == "avatar")
        #expect(parts.first?.filePath == "a.png")
        #expect(parts.first?.contentType == "image/png")
    }

    @Test("text still wins over params when both are present")
    func harTextWins() throws {
        let json = """
        {"log": {"entries": [{"request": {
          "method": "POST",
          "url": "https://api.example.com/login",
          "postData": {
            "mimeType": "application/x-www-form-urlencoded",
            "text": "user=ada",
            "params": [{"name": "ignored", "value": "yes"}]
          }
        }}]}}
        """
        let specs = try HarImporter.parse(Data(json.utf8))

        guard case let .raw(text, _) = specs.first?.body else {
            Issue.record("expected a raw body")
            return
        }
        #expect(text == "user=ada")
    }
}
