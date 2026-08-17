package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test

/**
 * Unit tests for the Hakka advanced search DSL.
 *
 * Covers:
 *   - parseStatusDsl: all syntax forms
 *   - parseSearchTokens: scope prefixes, negation, modes, quoting, edge cases
 *   - compileSearchQuery: token matching (all scopes/modes), status DSL, AND semantics,
 *     negation, wildcard, regex (valid and invalid), combined filters
 */
class SearchQueryTest {

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private fun req(
        url: String = "https://api.example.com/v1/users",
        method: HttpMethod = HttpMethod.GET,
        status: Int? = 200,
        requestHeaders: Map<String, List<String>> = mapOf("Authorization" to listOf("Bearer token123")),
        responseHeaders: Map<String, List<String>> = mapOf("content-type" to listOf("application/json; charset=utf-8")),
        requestBody: String? = """{"query":"hello"}""",
        responseBody: String? = """{"users":[{"id":1}]}""",
        requestBodySize: Long = 17L,
        responseBodySize: Long = 20L,
        durationMs: Long? = 100L,
        error: String? = null,
    ) = NetworkRequest(
        id = "r1",
        url = url,
        method = method,
        status = status,
        startTimeMs = 1000L,
        durationMs = durationMs,
        requestHeaders = requestHeaders,
        responseHeaders = responseHeaders,
        requestBodySize = requestBodySize,
        responseBodySize = responseBodySize,
        requestBody = requestBody,
        responseBody = responseBody,
        error = error,
        source = RequestSource.OKHTTP,
    )

    private fun match(
        query: String,
        statusDsl: String? = null,
        request: NetworkRequest = req(),
    ): Boolean {
        val tokens = parseSearchTokens(query)
        val predicate = compileSearchQuery(tokens, statusDsl)
        return predicate(request)
    }

    // ─── parseStatusDsl ───────────────────────────────────────────────────────

    @Nested
    inner class ParseStatusDsl {

        @Test
        fun `empty string returns null`() {
            assertNull(parseStatusDsl(""))
            assertNull(parseStatusDsl("   "))
        }

        @Test
        fun `class notation 2xx`() {
            assertEquals(200 to 299, parseStatusDsl("2xx"))
            assertEquals(200 to 299, parseStatusDsl("2XX"))
            assertEquals(200 to 299, parseStatusDsl("2Xx"))
        }

        @Test
        fun `class notation all classes`() {
            assertEquals(100 to 199, parseStatusDsl("1xx"))
            assertEquals(200 to 299, parseStatusDsl("2xx"))
            assertEquals(300 to 399, parseStatusDsl("3xx"))
            assertEquals(400 to 499, parseStatusDsl("4xx"))
            assertEquals(500 to 599, parseStatusDsl("5xx"))
        }

        @Test
        fun `inclusive range 200 to 299`() {
            assertEquals(200 to 299, parseStatusDsl("200..299"))
        }

        @Test
        fun `inclusive range lo equals hi`() {
            assertEquals(404 to 404, parseStatusDsl("404..404"))
        }

        @Test
        fun `inclusive range inverted returns null`() {
            assertNull(parseStatusDsl("299..200"))
        }

        @Test
        fun `exclusive upper range 200 to lt 300`() {
            assertEquals(200 to 299, parseStatusDsl("200..<300"))
        }

        @Test
        fun `exclusive upper where result lo exceeds hi returns null`() {
            assertNull(parseStatusDsl("200..<200"))
        }

        @Test
        fun `ge operator inclusive`() {
            assertEquals(400 to 599, parseStatusDsl(">=400"))
        }

        @Test
        fun `gt operator exclusive`() {
            assertEquals(401 to 599, parseStatusDsl(">400"))
        }

        @Test
        fun `le operator inclusive`() {
            assertEquals(100 to 404, parseStatusDsl("<=404"))
        }

        @Test
        fun `lt operator exclusive`() {
            assertEquals(100 to 499, parseStatusDsl("<500"))
        }

        @Test
        fun `exact code 404`() {
            assertEquals(404 to 404, parseStatusDsl("404"))
        }

        @Test
        fun `exact code 200`() {
            assertEquals(200 to 200, parseStatusDsl("200"))
        }

        @Test
        fun `unrecognised input returns null`() {
            assertNull(parseStatusDsl("garbage"))
            assertNull(parseStatusDsl("ok"))
            assertNull(parseStatusDsl("2x"))
            assertNull(parseStatusDsl("6xx"))
        }

        @Test
        fun `leading and trailing whitespace is trimmed`() {
            assertEquals(200 to 299, parseStatusDsl("  2xx  "))
        }
    }

    // ─── parseSearchTokens ─────────────────────────────────────────────────────

    @Nested
    inner class ParseSearchTokens {

        @Test
        fun `empty string returns empty list`() {
            assertTrue(parseSearchTokens("").isEmpty())
            assertTrue(parseSearchTokens("   ").isEmpty())
        }

        @Test
        fun `single bare word — substring, all scope, no negate`() {
            val tokens = parseSearchTokens("users")
            assertEquals(1, tokens.size)
            assertEquals(SearchToken(SearchScope.ALL, SearchMode.SUBSTRING, "users", false), tokens[0])
        }

        @Test
        fun `multiple whitespace-separated tokens`() {
            val tokens = parseSearchTokens("users GET")
            assertEquals(2, tokens.size)
            assertEquals("users", tokens[0].value)
            assertEquals("GET", tokens[1].value)
        }

        @Test
        fun `url scope prefix`() {
            val tokens = parseSearchTokens("url:example.com")
            assertEquals(1, tokens.size)
            assertEquals(SearchScope.URL, tokens[0].scope)
            assertEquals("example.com", tokens[0].value)
        }

        @Test
        fun `header scope prefix`() {
            val tokens = parseSearchTokens("header:Authorization")
            assertEquals(SearchScope.HEADER, tokens[0].scope)
            assertEquals("Authorization", tokens[0].value)
        }

        @Test
        fun `headers alias for header scope`() {
            val tokens = parseSearchTokens("headers:Content-Type")
            assertEquals(SearchScope.HEADER, tokens[0].scope)
        }

        @Test
        fun `body scope prefix`() {
            val tokens = parseSearchTokens("body:query")
            assertEquals(SearchScope.BODY, tokens[0].scope)
            assertEquals("query", tokens[0].value)
        }

        @Test
        fun `scope prefix is case-insensitive`() {
            val tokens = parseSearchTokens("URL:example.com")
            assertEquals(SearchScope.URL, tokens[0].scope)
        }

        @Test
        fun `leading dash negates token`() {
            val tokens = parseSearchTokens("-health")
            assertEquals(1, tokens.size)
            assertTrue(tokens[0].negate)
            assertEquals("health", tokens[0].value)
        }

        @Test
        fun `negation with scope prefix`() {
            val tokens = parseSearchTokens("-url:health")
            assertTrue(tokens[0].negate)
            assertEquals(SearchScope.URL, tokens[0].scope)
            assertEquals("health", tokens[0].value)
        }

        @Test
        fun `lone dash is ignored`() {
            val tokens = parseSearchTokens("-")
            assertTrue(tokens.isEmpty())
        }

        @Test
        fun `regex mode detected from forward slash delimiters`() {
            val tokens = parseSearchTokens("/v[0-9]+/")
            assertEquals(SearchMode.REGEX, tokens[0].mode)
            assertEquals("v[0-9]+", tokens[0].value)
        }

        @Test
        fun `wildcard mode with asterisk`() {
            val tokens = parseSearchTokens("*/users*")
            assertEquals(SearchMode.WILDCARD, tokens[0].mode)
        }

        @Test
        fun `wildcard mode with question mark`() {
            val tokens = parseSearchTokens("*/v?/*")
            assertEquals(SearchMode.WILDCARD, tokens[0].mode)
        }

        @Test
        fun `double-quoted phrase treated as single token`() {
            val tokens = parseSearchTokens(""""hello world"""")
            assertEquals(1, tokens.size)
            assertEquals("hello world", tokens[0].value)
        }

        @Test
        fun `single-quoted phrase treated as single token`() {
            val tokens = parseSearchTokens("'hello world'")
            assertEquals(1, tokens.size)
            assertEquals("hello world", tokens[0].value)
        }

        @Test
        fun `quoted phrase after scope prefix`() {
            val tokens = parseSearchTokens("""url:"example.com/v1"""")
            assertEquals(SearchScope.URL, tokens[0].scope)
            assertEquals("example.com/v1", tokens[0].value)
        }

        @Test
        fun `scope prefix with empty value after it is skipped`() {
            // "url:" with nothing after — should produce no token
            val tokens = parseSearchTokens("url:")
            assertTrue(tokens.isEmpty())
        }

        @Test
        fun `mixed tokens with scope negation and wildcard`() {
            val tokens = parseSearchTokens("url:api -health *users*")
            assertEquals(3, tokens.size)
            assertEquals(SearchScope.URL, tokens[0].scope)
            assertEquals(SearchMode.SUBSTRING, tokens[0].mode)
            assertTrue(tokens[1].negate)
            assertEquals(SearchMode.WILDCARD, tokens[2].mode)
        }
    }

    // ─── globToRegex ──────────────────────────────────────────────────────────

    @Nested
    inner class GlobToRegex {

        @Test
        fun `star matches any characters`() {
            val re = globToRegex("*users*")
            assertTrue(re.containsMatchIn("/api/users?page=1"))
            assertFalse(re.containsMatchIn("/api/orders"))
        }

        @Test
        fun `question mark matches exactly one character`() {
            val re = globToRegex("*/v?/*")
            assertTrue(re.containsMatchIn("/api/v1/users"))
            assertFalse(re.containsMatchIn("/api/v12/users"))
        }

        @Test
        fun `glob is case-insensitive`() {
            val re = globToRegex("*USERS*")
            assertTrue(re.containsMatchIn("/api/users"))
        }

        @Test
        fun `regex special chars in glob are escaped`() {
            val re = globToRegex("api.example.com")
            // dot in glob is a literal dot — "apiXexampleXcom" should NOT match
            assertFalse(re.containsMatchIn("apiXexampleXcom"))
            assertTrue(re.containsMatchIn("api.example.com"))
        }
    }

    // ─── compileSearchQuery — empty / no-op ───────────────────────────────────

    @Nested
    inner class CompileSearchQueryEmpty {

        @Test
        fun `empty tokens and no statusDsl — passes everything`() {
            val pred = compileSearchQuery(emptyList(), null)
            assertTrue(pred(req()))
        }

        @Test
        fun `empty tokens with statusDsl — only status filter applies`() {
            val pred = compileSearchQuery(emptyList(), "2xx")
            assertTrue(pred(req(status = 200)))
            assertFalse(pred(req(status = 404)))
        }
    }

    // ─── compileSearchQuery — scope matching ──────────────────────────────────

    @Nested
    inner class ScopeMatching {

        @Test
        fun `scope ALL searches url body and headers`() {
            // Match in URL
            assertTrue(match("users"))
            // Match in request body
            assertTrue(match("query", request = req(url = "https://example.com/orders")))
            // Match in response header value
            assertTrue(match("application/json", request = req(url = "https://example.com/other")))
        }

        @Test
        fun `scope URL only searches url`() {
            val tokens = parseSearchTokens("url:users")
            val pred = compileSearchQuery(tokens)
            // users in URL → match
            assertTrue(pred(req(url = "https://api.example.com/users")))
            // users in body only → no match
            assertFalse(pred(req(url = "https://api.example.com/orders", responseBody = "users")))
        }

        @Test
        fun `scope HEADER searches request and response header names and values`() {
            val tokens = parseSearchTokens("header:bearer")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(requestHeaders = mapOf("Authorization" to listOf("Bearer abc")))))
            assertFalse(pred(req(requestHeaders = emptyMap(), responseHeaders = emptyMap())))
        }

        @Test
        fun `scope HEADER matches header name`() {
            val tokens = parseSearchTokens("header:Authorization")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(requestHeaders = mapOf("Authorization" to listOf("Bearer x")))))
        }

        @Test
        fun `scope BODY searches requestBody and responseBody`() {
            val tokens = parseSearchTokens("body:query")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(requestBody = """{"query":"test"}""")))
            assertFalse(pred(req(requestBody = null, responseBody = null)))
        }

        @Test
        fun `scope BODY does not match url`() {
            val tokens = parseSearchTokens("body:users")
            val pred = compileSearchQuery(tokens)
            // "users" in URL only — should not match body scope
            assertFalse(pred(req(
                url = "https://api.example.com/users",
                requestBody = null,
                responseBody = null,
            )))
        }
    }

    // ─── compileSearchQuery — search modes ────────────────────────────────────

    @Nested
    inner class SearchModes {

        @Test
        fun `substring mode — case-insensitive`() {
            val tokens = parseSearchTokens("USERS")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(url = "https://api.example.com/users")))
        }

        @Test
        fun `substring mode — no match`() {
            val tokens = parseSearchTokens("orders")
            val pred = compileSearchQuery(tokens)
            assertFalse(pred(req(
                url = "https://api.example.com/users",
                requestBody = null, responseBody = null,
                requestHeaders = emptyMap(), responseHeaders = emptyMap(),
            )))
        }

        @Test
        fun `regex mode — matches pattern`() {
            val tokens = parseSearchTokens("/v[0-9]+/")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(url = "https://api.example.com/v1/users")))
            assertFalse(pred(req(url = "https://api.example.com/beta/users",
                requestBody = null, responseBody = null,
                requestHeaders = emptyMap(), responseHeaders = emptyMap())))
        }

        @Test
        fun `regex mode — case-insensitive`() {
            val tokens = parseSearchTokens("/USERS/")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(url = "https://api.example.com/users")))
        }

        @Test
        fun `regex mode — invalid regex never matches`() {
            val tokens = parseSearchTokens("/[invalid/")
            val pred = compileSearchQuery(tokens)
            assertFalse(pred(req()))
        }

        @Test
        fun `wildcard mode with star`() {
            val tokens = parseSearchTokens("*/users*")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(url = "https://api.example.com/users?page=1")))
            assertFalse(pred(req(url = "https://api.example.com/orders",
                requestBody = null, responseBody = null,
                requestHeaders = emptyMap(), responseHeaders = emptyMap())))
        }

        @Test
        fun `wildcard mode with question mark`() {
            val tokens = parseSearchTokens("*/v?/*")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(url = "https://api.example.com/v1/users")))
            assertFalse(pred(req(url = "https://api.example.com/v12/users",
                requestBody = null, responseBody = null,
                requestHeaders = emptyMap(), responseHeaders = emptyMap())))
        }

        @Test
        fun `wildcard star matches zero or more characters`() {
            val tokens = parseSearchTokens("api*users")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(url = "https://api.example.com/v1/users",
                requestBody = null, responseBody = null,
                requestHeaders = emptyMap(), responseHeaders = emptyMap())))
        }
    }

    // ─── compileSearchQuery — negation ────────────────────────────────────────

    @Nested
    inner class Negation {

        @Test
        fun `negated token excludes matches`() {
            val tokens = parseSearchTokens("-health")
            val pred = compileSearchQuery(tokens)
            assertFalse(pred(req(url = "https://api.example.com/health",
                requestBody = null, responseBody = null,
                requestHeaders = emptyMap(), responseHeaders = emptyMap())))
            assertTrue(pred(req(url = "https://api.example.com/users",
                requestBody = null, responseBody = null,
                requestHeaders = emptyMap(), responseHeaders = emptyMap())))
        }

        @Test
        fun `negated wildcard token`() {
            val tokens = parseSearchTokens("-*health*")
            val pred = compileSearchQuery(tokens)
            assertFalse(pred(req(url = "https://api.example.com/health",
                requestBody = null, responseBody = null,
                requestHeaders = emptyMap(), responseHeaders = emptyMap())))
        }

        @Test
        fun `negated regex token`() {
            val tokens = parseSearchTokens("-/health/")
            val pred = compileSearchQuery(tokens)
            assertFalse(pred(req(url = "https://api.example.com/health",
                requestBody = null, responseBody = null,
                requestHeaders = emptyMap(), responseHeaders = emptyMap())))
        }
    }

    // ─── compileSearchQuery — AND semantics ───────────────────────────────────

    @Nested
    inner class AndSemantics {

        @Test
        fun `two positive tokens — both must match`() {
            val tokens = parseSearchTokens("url:api url:users")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(url = "https://api.example.com/users")))
            assertFalse(pred(req(url = "https://api.example.com/orders")))
            assertFalse(pred(req(url = "https://other.com/users")))
        }

        @Test
        fun `positive + negative token — both conditions must hold`() {
            val tokens = parseSearchTokens("url:api -url:health")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(url = "https://api.example.com/users")))
            assertFalse(pred(req(url = "https://api.example.com/health")))
            assertFalse(pred(req(url = "https://other.com/users")))
        }

        @Test
        fun `three tokens — all must match`() {
            val tokens = parseSearchTokens("url:api url:v1 url:users")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(url = "https://api.example.com/v1/users")))
            assertFalse(pred(req(url = "https://api.example.com/v1/orders")))
            assertFalse(pred(req(url = "https://api.example.com/v2/users")))
        }
    }

    // ─── compileSearchQuery — statusDsl integration ───────────────────────────

    @Nested
    inner class StatusDslIntegration {

        @Test
        fun `2xx passes 200-299`() {
            val pred = compileSearchQuery(emptyList(), "2xx")
            assertTrue(pred(req(status = 200)))
            assertTrue(pred(req(status = 201)))
            assertTrue(pred(req(status = 299)))
            assertFalse(pred(req(status = 300)))
            assertFalse(pred(req(status = 199)))
        }

        @Test
        fun `4xx passes 400-499`() {
            val pred = compileSearchQuery(emptyList(), "4xx")
            assertTrue(pred(req(status = 400)))
            assertTrue(pred(req(status = 404)))
            assertTrue(pred(req(status = 499)))
            assertFalse(pred(req(status = 500)))
            assertFalse(pred(req(status = 399)))
        }

        @Test
        fun `ge 400 passes 400-599`() {
            val pred = compileSearchQuery(emptyList(), ">=400")
            assertTrue(pred(req(status = 400)))
            assertTrue(pred(req(status = 500)))
            assertFalse(pred(req(status = 399)))
        }

        @Test
        fun `exact 404`() {
            val pred = compileSearchQuery(emptyList(), "404")
            assertTrue(pred(req(status = 404)))
            assertFalse(pred(req(status = 200)))
            assertFalse(pred(req(status = 500)))
        }

        @Test
        fun `inclusive range 200 to 299`() {
            val pred = compileSearchQuery(emptyList(), "200..299")
            assertTrue(pred(req(status = 200)))
            assertTrue(pred(req(status = 250)))
            assertTrue(pred(req(status = 299)))
            assertFalse(pred(req(status = 300)))
        }

        @Test
        fun `exclusive upper range`() {
            val pred = compileSearchQuery(emptyList(), "200..<300")
            assertTrue(pred(req(status = 299)))
            assertFalse(pred(req(status = 300)))
        }

        @Test
        fun `null status excluded when DSL set`() {
            val pred = compileSearchQuery(emptyList(), "2xx")
            assertFalse(pred(req(status = null)))
        }

        @Test
        fun `invalid DSL — null range means no status filter`() {
            val pred = compileSearchQuery(emptyList(), "garbage")
            assertTrue(pred(req(status = 404)))
            assertTrue(pred(req(status = 200)))
        }

        @Test
        fun `null statusDsl — no status filtering`() {
            val pred = compileSearchQuery(emptyList(), null)
            assertTrue(pred(req(status = 404)))
            assertTrue(pred(req(status = null)))
        }
    }

    // ─── compileSearchQuery — combined tokens + statusDsl ─────────────────────

    @Nested
    inner class Combined {

        @Test
        fun `token AND statusDsl — both required`() {
            val tokens = parseSearchTokens("url:users")
            val pred = compileSearchQuery(tokens, "2xx")
            // Both match
            assertTrue(pred(req(url = "https://api.example.com/users", status = 200)))
            // URL matches, status does not
            assertFalse(pred(req(url = "https://api.example.com/users", status = 404)))
            // Status matches, URL does not
            assertFalse(pred(req(url = "https://api.example.com/orders", status = 200,
                requestBody = null, responseBody = null,
                requestHeaders = emptyMap(), responseHeaders = emptyMap())))
        }

        @Test
        fun `negated token + status range`() {
            val tokens = parseSearchTokens("-url:health")
            val pred = compileSearchQuery(tokens, "2xx")
            assertTrue(pred(req(url = "https://api.example.com/users", status = 200)))
            assertFalse(pred(req(url = "https://api.example.com/health", status = 200)))
            assertFalse(pred(req(url = "https://api.example.com/users", status = 404)))
        }

        @Test
        fun `regex token + statusDsl`() {
            val tokens = parseSearchTokens("/v[0-9]/")
            val pred = compileSearchQuery(tokens, ">=500")
            assertTrue(pred(req(url = "https://api.example.com/v1/crash", status = 500)))
            assertFalse(pred(req(url = "https://api.example.com/v1/users", status = 200)))
            assertFalse(pred(req(url = "https://api.example.com/beta", status = 500,
                requestBody = null, responseBody = null,
                requestHeaders = emptyMap(), responseHeaders = emptyMap())))
        }

        @Test
        fun `wildcard + statusDsl`() {
            val tokens = parseSearchTokens("*/api/*")
            val pred = compileSearchQuery(tokens, "4xx")
            assertTrue(pred(req(url = "https://example.com/api/v1", status = 404)))
            assertFalse(pred(req(url = "https://example.com/api/v1", status = 200)))
        }
    }

    // ─── Header multi-value ───────────────────────────────────────────────────

    @Nested
    inner class HeaderMultiValue {

        @Test
        fun `multi-value header — all values are searched`() {
            val tokens = parseSearchTokens("header:gzip")
            val pred = compileSearchQuery(tokens)
            val r = req(requestHeaders = mapOf("Accept-Encoding" to listOf("gzip", "deflate")))
            assertTrue(pred(r))
        }

        @Test
        fun `response header key searched`() {
            val tokens = parseSearchTokens("header:content-type")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(responseHeaders = mapOf("content-type" to listOf("application/json")))))
        }
    }

    // ─── Edge cases ───────────────────────────────────────────────────────────

    @Nested
    inner class EdgeCases {

        @Test
        fun `token matching null requestBody and responseBody`() {
            val tokens = parseSearchTokens("body:something")
            val pred = compileSearchQuery(tokens)
            assertFalse(pred(req(requestBody = null, responseBody = null)))
        }

        @Test
        fun `empty response body does not crash`() {
            val tokens = parseSearchTokens("body:hello")
            val pred = compileSearchQuery(tokens)
            assertFalse(pred(req(requestBody = "", responseBody = "")))
        }

        @Test
        fun `regex with dot in URL`() {
            val tokens = parseSearchTokens("/api\\.example/")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(url = "https://api.example.com/users")))
        }

        @Test
        fun `quoted phrase with spaces works end-to-end`() {
            val tokens = parseSearchTokens(""""application/json"""")
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(responseHeaders = mapOf("content-type" to listOf("application/json; charset=utf-8")))))
        }

        @Test
        fun `case-insensitive scope prefix URL uppercase`() {
            val tokens = parseSearchTokens("URL:users")
            assertEquals(SearchScope.URL, tokens[0].scope)
            val pred = compileSearchQuery(tokens)
            assertTrue(pred(req(url = "https://api.example.com/users")))
        }

        @Test
        fun `whitespace-only query produces no tokens`() {
            assertTrue(parseSearchTokens("   ").isEmpty())
        }

        @Test
        fun `tab-separated tokens are handled`() {
            val tokens = parseSearchTokens("users\tGET")
            assertEquals(2, tokens.size)
        }

        @Test
        fun `leading negate with scope prefix and regex`() {
            val tokens = parseSearchTokens("-url:/health/")
            assertEquals(1, tokens.size)
            assertTrue(tokens[0].negate)
            assertEquals(SearchScope.URL, tokens[0].scope)
            assertEquals(SearchMode.REGEX, tokens[0].mode)
            assertEquals("health", tokens[0].value)
        }

        @Test
        fun `multiple spaces between tokens`() {
            val tokens = parseSearchTokens("users   GET")
            assertEquals(2, tokens.size)
        }
    }

    // ─── Full match helper ────────────────────────────────────────────────────

    @Nested
    inner class FullMatchHelper {

        @Test
        fun `match helper uses both query string and statusDsl`() {
            assertTrue(match("url:users", "2xx",
                req(url = "https://api.example.com/users", status = 200)))
            assertFalse(match("url:users", "2xx",
                req(url = "https://api.example.com/orders", status = 200,
                    requestBody = null, responseBody = null,
                    requestHeaders = emptyMap(), responseHeaders = emptyMap())))
            assertFalse(match("url:users", "2xx",
                req(url = "https://api.example.com/users", status = 500)))
        }
    }
}
