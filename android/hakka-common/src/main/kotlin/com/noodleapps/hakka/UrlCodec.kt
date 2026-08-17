package com.noodleapps.hakka

/**
 * URL encode/decode helpers for the Hakka inspector's Decoded/Raw display toggle.
 * Mirrors packages/hakka-core/src/utils/urlCodec.ts semantics exactly:
 *  - [isUrlEncoded] detects at least one `%XX` percent-encoded sequence.
 *  - [decodeUrl] decodes percent-encoded sequences for human-readable display,
 *    falling back to the original string on malformed input (never throws).
 *  - [encodeUrl] re-encodes a decoded string back to percent-encoded form,
 *    idempotent on already-encoded input.
 *
 * Unlike [java.net.URLDecoder]/[java.net.URLEncoder] (`application/x-www-form-urlencoded`,
 * which also maps `+` ↔ space), these mirror JS `decodeURIComponent`/`encodeURIComponent`
 * semantics — `+` is left untouched — so results match the web/RN/iOS display exactly.
 */

private val PERCENT_ENCODED = Regex("%[0-9A-Fa-f]{2}")

/** Returns true if the string contains at least one percent-encoded sequence (%XX). */
fun isUrlEncoded(url: String): Boolean = PERCENT_ENCODED.containsMatchIn(url)

/**
 * Decode a percent-encoded string for human-readable display.
 * Falls back to the original string if decoding throws (e.g. malformed sequences
 * like `%GG` or a truncated `%` at the end of the string).
 */
fun decodeUrl(url: String): String =
    try {
        decodePercentEncoded(url)
    } catch (_: Exception) {
        url
    }

/**
 * Re-encode a decoded string so reserved characters are percent-escaped for the
 * display toggle. Idempotent on already-encoded strings (matches urlCodec.ts:
 * if the input already contains a `%XX` sequence, it is returned unchanged).
 *
 * Characters left unencoded mirror RFC 3986 unreserved + sub-delimiters + the
 * structural characters used in a URI path/query (`:@/%?#[]`).
 */
fun encodeUrl(url: String): String {
    if (isUrlEncoded(url)) return url
    val sb = StringBuilder()
    for (ch in url) {
        if (SAFE_PATH_CHARS.indexOf(ch) >= 0) {
            sb.append(ch)
        } else {
            for (b in ch.toString().toByteArray(Charsets.UTF_8)) {
                sb.append('%').append(String.format("%02X", b))
            }
        }
    }
    return sb.toString()
}

private const val SAFE_PATH_CHARS =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!\$&'()*+,;=:@/%?#[]"

/**
 * Percent-decodes [s] using UTF-8, matching JS `decodeURIComponent` — `+` is
 * treated literally (not decoded to a space, unlike `application/x-www-form-urlencoded`).
 * Throws on malformed sequences so callers (namely [decodeUrl]) can fall back safely.
 */
private fun decodePercentEncoded(s: String): String {
    if (!isUrlEncoded(s)) return s
    val bytes = java.io.ByteArrayOutputStream()
    var i = 0
    while (i < s.length) {
        val c = s[i]
        if (c == '%') {
            if (i + 2 >= s.length) throw IllegalArgumentException("Incomplete percent-encoding at index $i")
            val hex = s.substring(i + 1, i + 3)
            val byte = hex.toIntOrNull(16) ?: throw IllegalArgumentException("Invalid percent-encoding: %$hex")
            bytes.write(byte)
            i += 3
        } else {
            // Encode this single char as UTF-8 bytes directly so multi-byte (surrogate pair)
            // characters interleaved with %XX sequences still decode correctly.
            bytes.write(c.toString().toByteArray(Charsets.UTF_8))
            i += 1
        }
    }
    return bytes.toByteArray().toString(Charsets.UTF_8)
}

/**
 * Percent-decode a single query-param key or value (e.g. from `application/x-www-form-urlencoded`
 * bodies or query strings). Same semantics as [decodeUrl] but named for call-site clarity in
 * request/response detail views. Falls back to the original string on malformed input.
 */
fun percentDecode(s: String): String = decodeUrl(s)
