import Testing

@testable import HakkaCore

@Suite("detectLlmProvider — host table")
struct LlmProviderTests {
    @Test("detects each known provider by host, whatever the path", arguments: [
        ("https://api.openai.com/v1/chat/completions", LlmProvider.ID.openai, "OpenAI"),
        ("https://api.anthropic.com/v1/messages", LlmProvider.ID.anthropic, "Anthropic"),
        (
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent",
            LlmProvider.ID.gemini, "Gemini"
        ),
        ("https://openrouter.ai/api/v1/chat/completions", LlmProvider.ID.openrouter, "OpenRouter"),
        ("https://api.groq.com/openai/v1/chat/completions", LlmProvider.ID.groq, "Groq"),
        ("https://api.mistral.ai/v1/chat/completions", LlmProvider.ID.mistral, "Mistral"),
    ] as [(String, LlmProvider.ID, String)])
    func detectsKnownProviders(url: String, id: LlmProvider.ID, label: String) {
        #expect(detectLlmProvider(url: url) == LlmProvider(id: id, label: label), "\(url)")
    }

    @Test("matches Azure by resource-host suffix across deployment paths")
    func matchesAzureBySuffix() {
        let url = "https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21"
        #expect(detectLlmProvider(url: url) == LlmProvider(id: .azureOpenAI, label: "Azure"))
    }

    @Test("returns nil for hosts outside the table — even OpenAI-shaped paths", arguments: [
        "https://api.example.com/v1/chat/completions",
        "http://localhost:11434/v1/chat/completions",
        "https://myapp.dev/api/chat",
    ])
    func returnsNilOutsideTable(url: String) {
        #expect(detectLlmProvider(url: url) == nil, "\(url)")
    }

    @Test("tolerates ports and mixed case")
    func toleratesPortAndCase() {
        #expect(detectLlmProvider(url: "https://API.OPENAI.COM:443/v1/responses")?.id == .openai)
    }
}
