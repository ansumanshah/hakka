# Security Policy

Hakka captures network traffic. Privacy and data-handling bugs that can expose sensitive request or response data are treated as security issues.

## Supported Versions

Pre-1.0. All versions receive fixes on the latest release.

## Reporting

Do not open a public GitHub issue for security vulnerabilities.

Email `ansumanshah@gmail.com` with subject `[SECURITY] <brief description>`.

Include:

- affected package and version or commit
- reproduction steps
- expected vs actual behavior
- proof-of-concept code or logs if available
- whether sensitive headers, bodies, or HAR export are involved

## Response Timeline

Best-effort. Acknowledgement within 48 hours, fix or mitigation within 90 days. No public disclosure before a fix is available.

## Scope

In scope:

- header redaction bypass
- body preview limit bypass
- captured data leaking to disk, UI, or HAR export
- self-capture loops exposing local bridge payloads
- mock/replay escaping development or test boundaries

Out of scope:

- cosmetic UI bugs
- example app-only issues without SDK impact
- performance regressions that do not expose data
- third-party dependency issues without Hakka-specific impact
