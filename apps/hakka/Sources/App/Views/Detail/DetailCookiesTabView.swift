import HakkaCommon
import HakkaCore
import SwiftUI

/// The Cookies tab: what the request's `Cookie` header carried, and what
/// each of the response's `Set-Cookie` headers set — attributes shown as
/// structured fields rather than a raw header string, which is exactly the
/// chore this tab exists to remove. Only reachable when `DetailTab.visible`
/// found at least one cookie on either side, so there is no empty-state to
/// design for here.
struct DetailCookiesTabView: View {
    private let sent: [ParsedCookiePair]
    private let set: [ParsedSetCookie]

    init(record: NetworkRequest) {
        sent = CookieHeaderParser.parseCookieHeader(fromRequestHeaders: record.requestHeaders)
        set = CookieHeaderParser.parseSetCookieHeaders(fromResponseHeaders: record.responseHeaders)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            if !sent.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    sectionTitle("Sent (\(sent.count))")
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        ForEach(sent) { pair in
                            SentCookieRow(pair: pair)
                        }
                    }
                }
            }
            if !set.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    sectionTitle("Set by response (\(set.count))")
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        ForEach(set) { cookie in
                            SetCookieCard(cookie: cookie)
                        }
                    }
                }
            }
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
    }
}

/// One `Cookie` pair the request carried — same layout as
/// `DetailHeadersSection`'s rows, so the tab reads as part of the same
/// family rather than a one-off.
private struct SentCookieRow: View {
    let pair: ParsedCookiePair

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Text(pair.name)
                .font(.caption.weight(.medium))
                .frame(width: 140, alignment: .leading)
            Text(pair.value)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}

/// One `Set-Cookie` response header as a card: name/value, its security
/// flags as tags, then every attribute the server sent.
private struct SetCookieCard: View {
    let cookie: ParsedSetCookie

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.sm) {
                Text(cookie.name).font(.caption.weight(.semibold))
                Spacer()
                flags
            }
            Text(cookie.value)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                attributeRow("Domain", cookie.domain)
                attributeRow("Path", cookie.path)
                attributeRow("Expires", cookie.expires)
                attributeRow("Max-Age", cookie.maxAge)
            }
        }
        .padding(Spacing.ml)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    @ViewBuilder
    private var flags: some View {
        HStack(spacing: Spacing.xs) {
            if cookie.secure { flag("lock.fill", "Secure", ThemeTokens.Status.success) }
            if cookie.httpOnly { flag("eye.slash.fill", "HttpOnly", ThemeTokens.Status.info) }
            if let sameSite = cookie.sameSite { flag("shield.fill", sameSite, ThemeTokens.Status.warning) }
        }
    }

    private func flag(_ symbol: String, _ label: String, _ tint: Color) -> some View {
        Label(label, systemImage: symbol)
            .font(.caption2.weight(.medium))
            .foregroundStyle(tint)
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, Spacing.xxs)
            .background(tint.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    @ViewBuilder
    private func attributeRow(_ label: String, _ value: String?) -> some View {
        if let value {
            HStack(spacing: Spacing.sm) {
                Text(label)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.tertiary)
                    .frame(width: 70, alignment: .leading)
                Text(value)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
    }
}
