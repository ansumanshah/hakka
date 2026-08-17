package com.noodleapps.hakka

/**
 * Cookie parsing utilities — mirrors packages/hakka-core/src/utils/cookies.ts.
 *
 * Two entry points:
 *  - [parseRequestCookies] parses a `Cookie:` request header into name/value pairs.
 *  - [parseSetCookie] parses one or more `Set-Cookie:` response header values into
 *    [ParsedCookie] objects including attributes (Domain, Path, Expires, Max-Age,
 *    HttpOnly, Secure, SameSite).
 *
 * These are used for DISPLAY only.  Cookies remain redacted in [NetworkRequest]
 * (captured headers) and in HAR export.
 */

/** A name/value pair from a `Cookie:` request header. */
data class RequestCookie(val name: String, val value: String)

/**
 * A fully parsed `Set-Cookie:` response cookie with optional attributes.
 * Mirrors [ParsedCookie] in packages/hakka-core/src/utils/cookies.ts.
 */
data class ParsedCookie(
    val name: String,
    val value: String,
    val domain: String? = null,
    val path: String? = null,
    val expires: String? = null,
    val maxAge: Long? = null,
    val httpOnly: Boolean = false,
    val secure: Boolean = false,
    val sameSite: SameSite? = null,
) {
    enum class SameSite { Strict, Lax, None }
}

/**
 * Parse a `Cookie:` request header value into name/value pairs.
 * Splits on `;`, trims whitespace, splits on the first `=`.
 */
fun parseRequestCookies(cookieHeader: String?): List<RequestCookie> {
    if (cookieHeader.isNullOrBlank()) return emptyList()
    return cookieHeader
        .split(';')
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .map { part ->
            val idx = part.indexOf('=')
            if (idx == -1) RequestCookie(name = part, value = "")
            else RequestCookie(
                name = part.substring(0, idx).trim(),
                value = part.substring(idx + 1).trim(),
            )
        }
}

/**
 * Parse one or more `Set-Cookie:` header values into [ParsedCookie] objects.
 * Accepts a list of strings (one per `Set-Cookie` header).
 * Attribute keys are matched case-insensitively.
 */
fun parseSetCookie(setCookieValues: List<String>): List<ParsedCookie> =
    setCookieValues.map { parseSingleSetCookie(it) }

private fun parseSingleSetCookie(line: String): ParsedCookie {
    val parts = line.split(';')
    val rawNameVal = parts.firstOrNull() ?: ""
    val attrParts = parts.drop(1)

    val eqIdx = rawNameVal.indexOf('=')
    val name = if (eqIdx == -1) rawNameVal.trim() else rawNameVal.substring(0, eqIdx).trim()
    val value = if (eqIdx == -1) "" else rawNameVal.substring(eqIdx + 1).trim()

    var domain: String? = null
    var path: String? = null
    var expires: String? = null
    var maxAge: Long? = null
    var httpOnly = false
    var secure = false
    var sameSite: ParsedCookie.SameSite? = null

    for (attr in attrParts) {
        val trimmed = attr.trim()
        if (trimmed.isEmpty()) continue
        val attrEq = trimmed.indexOf('=')
        val attrKey = (if (attrEq == -1) trimmed else trimmed.substring(0, attrEq)).trim().lowercase()
        val attrVal = if (attrEq == -1) "" else trimmed.substring(attrEq + 1).trim()

        when (attrKey) {
            "domain" -> domain = attrVal
            "path" -> path = attrVal
            "expires" -> expires = attrVal
            "max-age" -> maxAge = attrVal.toLongOrNull()
            "httponly" -> httpOnly = true
            "secure" -> secure = true
            "samesite" -> sameSite = when (attrVal.lowercase()) {
                "strict" -> ParsedCookie.SameSite.Strict
                "lax" -> ParsedCookie.SameSite.Lax
                "none" -> ParsedCookie.SameSite.None
                else -> null
            }
        }
    }

    return ParsedCookie(
        name = name,
        value = value,
        domain = domain,
        path = path,
        expires = expires,
        maxAge = maxAge,
        httpOnly = httpOnly,
        secure = secure,
        sameSite = sameSite,
    )
}
