package com.noodleapps.hakka

/**
 * Search DSL parser + compiled predicate for Hakka network requests.
 *
 * Mirrors TypeScript:
 *   packages/hakka-core/src/query/parser.ts  — parseSearchTokens + parseStatusDsl
 *   packages/hakka-core/src/query/compile.ts — compileQuery
 *
 * Pure functions/objects — no Android dependencies, fully unit-testable on JVM.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Which field(s) of a request to search against. */
enum class SearchScope { ALL, URL, HEADER, BODY }

/** How the search value is interpreted. */
enum class SearchMode { SUBSTRING, WILDCARD, REGEX }

/** A single parsed token from the search bar query string. */
data class SearchToken(
    val scope: SearchScope,
    val mode: SearchMode,
    val value: String,
    /** When true the token must NOT match for the request to pass. */
    val negate: Boolean,
)

// ─── Status DSL ───────────────────────────────────────────────────────────────

/**
 * Parse a status DSL string into an inclusive [lo, hi] range.
 *
 * Supported forms:
 *   "2xx" / "2XX"        → [200, 299]
 *   "200..299"           → [200, 299]  (inclusive)
 *   "200..<300"          → [200, 299]  (exclusive upper)
 *   ">=400"              → [400, 599]
 *   ">400"               → [401, 599]
 *   "<=404"              → [100, 404]
 *   "<500"               → [100, 499]
 *   "404"                → [404, 404]
 *
 * Returns null for unrecognised input.
 */
fun parseStatusDsl(dsl: String): Pair<Int, Int>? {
    val s = dsl.trim()
    if (s.isEmpty()) return null

    // "NXX" class notation — 1xx/2xx/3xx/4xx/5xx (case-insensitive)
    val classMatch = Regex("""^([1-5])[xX]{2}$""").matchEntire(s)
    if (classMatch != null) {
        val base = classMatch.groupValues[1].toInt() * 100
        return base to base + 99
    }

    // "200..<300" exclusive upper
    val exclRange = Regex("""^(\d{3})\.\.<(\d{3})$""").matchEntire(s)
    if (exclRange != null) {
        val lo = exclRange.groupValues[1].toInt()
        val hi = exclRange.groupValues[2].toInt() - 1
        if (lo > hi) return null
        return lo to hi
    }

    // "200..299" inclusive range
    val inclRange = Regex("""^(\d{3})\.\.(\d{3})$""").matchEntire(s)
    if (inclRange != null) {
        val lo = inclRange.groupValues[1].toInt()
        val hi = inclRange.groupValues[2].toInt()
        if (lo > hi) return null
        return lo to hi
    }

    // ">=400" / ">400"
    val geMatch = Regex("""^(>=?)(\d{3})$""").matchEntire(s)
    if (geMatch != null) {
        val inclusive = geMatch.groupValues[1] == ">="
        val value = geMatch.groupValues[2].toInt()
        val lo = if (inclusive) value else value + 1
        return lo to 599
    }

    // "<=404" / "<500"
    val leMatch = Regex("""^(<=?)(\d{3})$""").matchEntire(s)
    if (leMatch != null) {
        val inclusive = leMatch.groupValues[1] == "<="
        val value = leMatch.groupValues[2].toInt()
        val hi = if (inclusive) value else value - 1
        return 100 to hi
    }

    // "404" exact single code
    val exact = Regex("""^(\d{3})$""").matchEntire(s)
    if (exact != null) {
        val code = exact.groupValues[1].toInt()
        return code to code
    }

    return null
}

// ─── Token parser ─────────────────────────────────────────────────────────────

private val SCOPE_PREFIXES: Map<String, SearchScope> = mapOf(
    "url:" to SearchScope.URL,
    "header:" to SearchScope.HEADER,
    "headers:" to SearchScope.HEADER,
    "body:" to SearchScope.BODY,
)

/**
 * Detect mode from the raw value string (after prefix and negate stripping).
 * Returns the detected mode and the cleaned value.
 */
private fun detectMode(raw: String): Pair<SearchMode, String> {
    // /regex/ notation
    if (raw.startsWith('/') && raw.endsWith('/') && raw.length > 2) {
        return SearchMode.REGEX to raw.substring(1, raw.length - 1)
    }
    // wildcard — contains * or ?
    if (raw.contains('*') || raw.contains('?')) {
        return SearchMode.WILDCARD to raw
    }
    return SearchMode.SUBSTRING to raw
}

/**
 * Tokenise a raw search bar string into structured SearchTokens.
 *
 * Rules:
 *   - Tokens are whitespace-separated.
 *   - "quoted phrases" are kept as a single token (quotes stripped).
 *   - Scope prefix: `url:`, `header:` / `headers:`, `body:` before the value.
 *   - Leading `-` → negate.
 *   - `/pattern/` → regex mode.
 *   - `*glob*` / `?` → wildcard mode.
 *   - Everything else → substring.
 *   - Empty or whitespace-only input → [].
 */
fun parseSearchTokens(raw: String): List<SearchToken> {
    if (raw.isBlank()) return emptyList()

    val tokens = mutableListOf<SearchToken>()
    val parts = splitRespectingQuotes(raw)

    for (part in parts) {
        if (part.isEmpty()) continue

        var rest = part
        var negate = false

        // Leading '-' means negate only when there is content after it.
        if (rest.startsWith('-') && rest.length > 1) {
            negate = true
            rest = rest.substring(1)
        }

        // A bare '-' (or empty after stripping) has no search meaning.
        if (rest == "-" || rest.isEmpty()) continue

        var scope = SearchScope.ALL
        for ((prefix, s) in SCOPE_PREFIXES) {
            if (rest.lowercase().startsWith(prefix)) {
                scope = s
                rest = rest.substring(prefix.length)
                break
            }
        }

        if (rest.isEmpty()) continue

        val (mode, value) = detectMode(rest)
        if (value.isEmpty()) continue

        tokens.add(SearchToken(scope, mode, value, negate))
    }

    return tokens
}

/**
 * Split a string on whitespace while keeping quoted substrings together.
 * Quotes are stripped from the result.
 */
private fun splitRespectingQuotes(input: String): List<String> {
    val results = mutableListOf<String>()
    var current = StringBuilder()
    var inQuote = false
    var quoteChar = ' '

    for (ch in input) {
        when {
            inQuote -> {
                if (ch == quoteChar) inQuote = false
                else current.append(ch)
            }
            ch == '"' || ch == '\'' -> {
                inQuote = true
                quoteChar = ch
            }
            ch == ' ' || ch == '\t' -> {
                if (current.isNotEmpty()) {
                    results.add(current.toString())
                    current = StringBuilder()
                }
            }
            else -> current.append(ch)
        }
    }

    if (current.isNotEmpty()) results.add(current.toString())
    return results
}

// ─── Glob → Regex ─────────────────────────────────────────────────────────────

/**
 * Convert a glob pattern (star and question-mark wildcards only) to a Regex.
 * Case-insensitive.
 */
internal fun globToRegex(pattern: String): Regex {
    val sb = StringBuilder()
    for (ch in pattern) {
        when (ch) {
            '*' -> sb.append(".*")
            '?' -> sb.append(".")
            else -> sb.append(Regex.escape(ch.toString()))
        }
    }
    return Regex(sb.toString(), RegexOption.IGNORE_CASE)
}

// ─── Compiled token ────────────────────────────────────────────────────────────

private class CompiledToken(
    val scope: SearchScope,
    val negate: Boolean,
    val test: (String) -> Boolean,
)

private fun compileToken(token: SearchToken): CompiledToken {
    val test: (String) -> Boolean = when (token.mode) {
        SearchMode.REGEX -> {
            val re: Regex? = try {
                Regex(token.value, RegexOption.IGNORE_CASE)
            } catch (_: Exception) {
                null
            }
            // Capture re in a local val so the lambda doesn't capture the nullable
            if (re != null) {
                val safeRe = re
                val fn: (String) -> Boolean = { text -> safeRe.containsMatchIn(text) }
                fn
            } else {
                val fn: (String) -> Boolean = { _ -> false }
                fn
            }
        }
        SearchMode.WILDCARD -> {
            val re = globToRegex(token.value)
            val fn: (String) -> Boolean = { text -> re.containsMatchIn(text) }
            fn
        }
        SearchMode.SUBSTRING -> {
            val lower = token.value.lowercase()
            val fn: (String) -> Boolean = { text -> text.lowercase().contains(lower) }
            fn
        }
    }
    return CompiledToken(scope = token.scope, negate = token.negate, test = test)
}

// ─── Text extraction per scope ────────────────────────────────────────────────

private fun getUrlText(req: NetworkRequest): String = req.url

private fun getHeaderText(req: NetworkRequest): String {
    val parts = mutableListOf<String>()
    for (headers in listOf(req.requestHeaders, req.responseHeaders)) {
        for ((k, values) in headers) {
            parts.add(k)
            parts.addAll(values)
        }
    }
    return parts.joinToString("\n")
}

private fun getBodyText(req: NetworkRequest): String =
    listOfNotNull(req.requestBody, req.responseBody).joinToString("\n")

private fun getAllText(req: NetworkRequest): String =
    listOf(getUrlText(req), getHeaderText(req), getBodyText(req)).joinToString("\n")

private fun getScopedText(req: NetworkRequest, scope: SearchScope): String = when (scope) {
    SearchScope.URL -> getUrlText(req)
    SearchScope.HEADER -> getHeaderText(req)
    SearchScope.BODY -> getBodyText(req)
    SearchScope.ALL -> getAllText(req)
}

// ─── compileSearchQuery ───────────────────────────────────────────────────────

/**
 * Compile a list of [SearchToken] (plus an optional status DSL) into a fast predicate.
 *
 * Regex/glob patterns are compiled exactly once. The returned function can be called
 * on many requests without re-compiling.
 *
 * All active tokens are ANDed together (same semantics as the TypeScript compileQuery).
 *
 * [statusDsl] is the chip-selected status filter ("2xx", ">=400", …). When non-null
 * it is AND-ed with the token predicates.
 */
fun compileSearchQuery(
    tokens: List<SearchToken>,
    statusDsl: String? = null,
): (NetworkRequest) -> Boolean {
    val compiled = tokens.map { compileToken(it) }
    val statusRange: Pair<Int, Int>? = statusDsl?.takeIf { it.isNotEmpty() }?.let { parseStatusDsl(it) }

    return { req ->
        // Token matching — AND across all tokens
        var pass = true
        for (ct in compiled) {
            val text = getScopedText(req, ct.scope)
            val matched = ct.test(text)
            if (if (ct.negate) matched else !matched) {
                pass = false
                break
            }
        }

        // Status DSL
        if (pass && statusRange != null) {
            val status = req.status
            if (status == null || status < statusRange.first || status > statusRange.second) {
                pass = false
            }
        }

        pass
    }
}
