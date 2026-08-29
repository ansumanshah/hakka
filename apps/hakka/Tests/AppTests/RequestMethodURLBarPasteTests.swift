import HakkaCore
import Testing
@testable import HakkaApp

/// `RequestMethodURLBar.looksLikeCurlCommand` gates whether a pasted string
/// even reaches `CurlImporter.parse` (see `applyPaste`). It must accept
/// exactly what `CurlImporter.parse` itself accepts — a leading shell
/// prompt, `sudo`, or an env-var prefix before the literal `curl` token —
/// or a curl-shaped paste that `CurlImporter` would happily import instead
/// dumps raw shell text into the URL field.
@Suite("RequestMethodURLBar curl paste detection")
struct RequestMethodURLBarPasteTests {
    @Test func plainCurlCommandIsRecognized() {
        #expect(RequestMethodURLBar.looksLikeCurlCommand("curl https://api.example.com/users"))
    }

    @Test func shellPromptPrefixedCurlIsRecognized() {
        #expect(RequestMethodURLBar.looksLikeCurlCommand("$ curl https://api.example.com/users"))
    }

    @Test func sudoPrefixedCurlIsRecognized() {
        #expect(RequestMethodURLBar.looksLikeCurlCommand("sudo curl https://api.example.com/users"))
    }

    @Test func envVarPrefixedCurlIsRecognized() {
        #expect(RequestMethodURLBar.looksLikeCurlCommand("TOKEN=abc curl https://api.example.com/users"))
    }

    @Test func plainURLIsNotRecognized() {
        #expect(!RequestMethodURLBar.looksLikeCurlCommand("https://api.example.com/users"))
    }

    @Test func emptyStringIsNotRecognized() {
        #expect(!RequestMethodURLBar.looksLikeCurlCommand(""))
    }

    /// The behavior that actually matters: everything `looksLikeCurlCommand`
    /// accepts, `CurlImporter.parse` must also succeed on — otherwise the
    /// gate is pointless. Pins the two together so they can't drift again.
    @Test func everythingRecognizedAlsoParsesSuccessfully() throws {
        for command in [
            "curl https://api.example.com/users",
            "$ curl https://api.example.com/users",
            "sudo curl https://api.example.com/users",
            "TOKEN=abc curl https://api.example.com/users",
        ] {
            #expect(RequestMethodURLBar.looksLikeCurlCommand(command))
            let spec = try CurlImporter.parse(command)
            #expect(spec.url == "https://api.example.com/users")
        }
    }
}
