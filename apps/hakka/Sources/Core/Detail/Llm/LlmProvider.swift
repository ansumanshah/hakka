import Foundation

/// The LLM provider behind a request URL, matched by host alone — traffic
/// rows are slim (no bodies), so URL-derived UI can rely on nothing but the
/// host; anything body-dependent (model, usage) belongs to the detail pane's
/// presenters.
public struct LlmProvider: Sendable, Equatable {
    /// Which provider matched; several share the OpenAI wire shape.
    public enum ID: String, Sendable {
        case openai
        case azureOpenAI = "azure-openai"
        case anthropic
        case gemini
        case openrouter
        case groq
        case mistral
    }

    /// The matched provider.
    public let id: ID
    /// Short badge label.
    public let label: String

    public init(id: ID, label: String) {
        self.id = id
        self.label = label
    }
}

/// One row of the host table: exact hosts, plus resource-style host
/// suffixes (the deployment-host pattern).
private struct LlmProviderRule {
    let id: LlmProvider.ID
    let label: String
    /// Matched as an exact host.
    let hosts: Set<String>
    /// Matched as a host suffix (resource-style subdomains).
    let hostSuffixes: [String]
}

private let llmProviderRules: [LlmProviderRule] = [
    LlmProviderRule(id: .openai, label: "OpenAI", hosts: ["api.openai.com"], hostSuffixes: []),
    LlmProviderRule(id: .azureOpenAI, label: "Azure", hosts: [], hostSuffixes: [".openai.azure.com"]),
    LlmProviderRule(id: .anthropic, label: "Anthropic", hosts: ["api.anthropic.com"], hostSuffixes: []),
    LlmProviderRule(id: .gemini, label: "Gemini", hosts: ["generativelanguage.googleapis.com"], hostSuffixes: []),
    LlmProviderRule(id: .openrouter, label: "OpenRouter", hosts: ["openrouter.ai"], hostSuffixes: []),
    LlmProviderRule(id: .groq, label: "Groq", hosts: ["api.groq.com"], hostSuffixes: []),
    LlmProviderRule(id: .mistral, label: "Mistral", hosts: ["api.mistral.ai"], hostSuffixes: []),
]

/// The hostname of `url`, lowercased with the port dropped; scheme-less
/// input gets one lenient `https://` retry.
private func llmHost(of url: String) -> String? {
    let candidate = URL(string: url) ?? URL(string: "https://" + url)
    guard let host = candidate?.host else { return nil }
    return host.lowercased()
}

/// The provider behind `url`, or `nil` when the host matches no known rule.
public func detectLlmProvider(url: String) -> LlmProvider? {
    guard let host = llmHost(of: url) else { return nil }
    for rule in llmProviderRules
    where rule.hosts.contains(host) || rule.hostSuffixes.contains(where: host.hasSuffix) {
        return LlmProvider(id: rule.id, label: rule.label)
    }
    return nil
}
