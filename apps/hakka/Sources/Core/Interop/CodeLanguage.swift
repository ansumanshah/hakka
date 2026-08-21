import Foundation
import HakkaCommon

public enum CodeLanguage: String, Sendable, CaseIterable {
    case curl
    case javascript
    case swift
    case python
    case go
    case httpie
}

/// Generates pasteable request code in one of `CodeLanguage`'s targets from
/// an already-resolved `RequestSpec` — see `EffectiveRequest`'s doc comment
/// for what "resolved" means. `secrets` controls whether credential values
/// are emitted raw or replaced with a redaction placeholder; callers must
/// choose explicitly (see `SecretDisplay`).
public enum CodeGenerator {
    public static func generate(_ spec: RequestSpec, language: CodeLanguage, secrets: SecretDisplay) -> String {
        let effective = EffectiveRequest(spec, secrets: secrets)
        switch language {
        case .curl: return CurlCodeGenerator.generate(effective)
        case .javascript: return JavaScriptCodeGenerator.generate(effective)
        case .swift: return SwiftCodeGenerator.generate(effective)
        case .python: return PythonCodeGenerator.generate(effective)
        case .go: return GoCodeGenerator.generate(effective)
        case .httpie: return HttpieCodeGenerator.generate(effective)
        }
    }
}
