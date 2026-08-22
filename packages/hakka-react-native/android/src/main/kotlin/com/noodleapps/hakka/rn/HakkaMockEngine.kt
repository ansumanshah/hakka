package com.noodleapps.hakka.rn

import kotlin.math.max
import java.util.concurrent.atomic.AtomicLong
import java.util.regex.Pattern
import java.util.regex.PatternSyntaxException
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Platform-neutral transport-error codes for a [failure]-mode rule. Mirrors
 * `MockFailureCode` in `packages/hakka-core/src/engine/MockEngine.ts` — the source of
 * truth; read it there for the full cross-runtime mapping table. Vendored here for the
 * same reason as [MockRuleModify]: this module runs its own mock engine
 * ([HakkaMockEngine]) rather than hakka-network's.
 */
enum class MockFailureCode(val wireValue: String) {
    TIMEOUT("timeout"),
    NO_CONNECTION("noConnection"),
    CANNOT_FIND_HOST("cannotFindHost"),
    CANNOT_CONNECT_TO_HOST("cannotConnectToHost"),
    CONNECTION_LOST("connectionLost"),
    SECURE_CONNECTION_FAILED("secureConnectionFailed"),
    CANCELLED("cancelled"),
    UNKNOWN("unknown");

    /** Human-readable message shared with every reporting call site. */
    val message: String
        get() = when (this) {
            TIMEOUT -> "Mocked failure: the request timed out"
            NO_CONNECTION -> "Mocked failure: not connected to the internet"
            CANNOT_FIND_HOST -> "Mocked failure: cannot find host"
            CANNOT_CONNECT_TO_HOST -> "Mocked failure: cannot connect to host"
            CONNECTION_LOST -> "Mocked failure: the network connection was lost"
            SECURE_CONNECTION_FAILED -> "Mocked failure: secure connection failed"
            CANCELLED -> "Mocked failure: cancelled"
            UNKNOWN -> "Mocked failure: unknown network error"
        }

    companion object {
        fun fromWireValue(value: String): MockFailureCode? = entries.firstOrNull { it.wireValue == value }
    }
}

/**
 * Simulates a transport-level failure — the request never gets a real response —
 * rather than serving the canned response. Mirrors `MockFailure` in `MockEngine.ts`.
 * Precedence: [failure] (via [HakkaMockRule.failure]) is checked before `block`, which is
 * checked before the rewrite path (`redirectTo`/`modify`).
 */
data class MockFailure(val code: MockFailureCode)

/**
 * Declarative request/response edits — plain data, no functions, so a rule carrying only a
 * [modify] block is fully serializable over the wire. Mirrors `MockRuleModify` in
 * `packages/hakka-core/src/engine/MockEngine.ts`; vendored here because this module runs its own
 * mock engine ([HakkaMockEngine]) rather than hakka-network's.
 *
 * v1 scope: header/query set-or-remove, response status override, plain-string body find/replace.
 */
data class MockRuleModify(
    val setRequestHeaders: Map<String, String>? = null,
    val removeRequestHeaders: List<String>? = null,
    val setQueryParams: Map<String, String>? = null,
    val removeQueryParams: List<String>? = null,
    val status: Int? = null,
    val setResponseHeaders: Map<String, String>? = null,
    val removeResponseHeaders: List<String>? = null,
    val replaceBody: List<BodyReplacement>? = null,
) {
    /** A single plain-string find/replace pair (see [replaceBody]). */
    data class BodyReplacement(val find: String, val replace: String)
}

/**
 * Pure declarative-edit application — mirrors `MockEngine.ts`'s `applyHeaderEdits` /
 * `applyQueryEdits` / `applyBodyReplacements` (and `hakka-network`'s own `MockRuleTransform`)
 * exactly: case-insensitive header removal, exact-key header set, plain-string body find/replace
 * applied in order (empty `find` skipped — it would otherwise be a pathological no-op). No side
 * effects; used by [NativeMockInterceptor]'s passthrough-then-transform path.
 */
object MockRuleTransform {

    /** Set/remove edits for a plain header map. Case-insensitive removal; exact-key set. */
    fun applyHeaderEdits(
        headers: Map<String, String>,
        set: Map<String, String>?,
        remove: List<String>?,
    ): Map<String, String> {
        if (set == null && remove == null) return headers
        val next = LinkedHashMap(headers)
        if (!remove.isNullOrEmpty()) {
            val removeLower = remove.map { it.lowercase() }.toSet()
            next.keys.filter { it.lowercase() in removeLower }.forEach { next.remove(it) }
        }
        set?.forEach { (k, v) -> next[k] = v }
        return next
    }

    /**
     * Set/remove edits for a URL's query string. Falls back to returning the URL unchanged
     * if it cannot be parsed as an [okhttp3.HttpUrl] (fail-open, mirrors `MockEngine.ts`'s
     * try/catch fallback).
     */
    fun applyQueryEdits(url: String, set: Map<String, String>?, remove: List<String>?): String {
        if (set == null && remove == null) return url
        val parsed = url.toHttpUrlOrNull() ?: return url
        val builder = parsed.newBuilder()

        if (!remove.isNullOrEmpty()) {
            for (key in remove) builder.removeAllQueryParameters(key)
        }
        set?.forEach { (key, value) -> builder.setQueryParameter(key, value) }

        return builder.build().toString()
    }

    /**
     * Plain-string (no regex) find/replace, applied in order. Empty `find` is skipped
     * (would otherwise be a pathological no-op).
     */
    fun applyBodyReplacements(body: String, replacements: List<MockRuleModify.BodyReplacement>?): String {
        if (replacements.isNullOrEmpty()) return body
        var next = body
        for (replacement in replacements) {
            if (replacement.find.isEmpty()) continue
            next = next.replace(replacement.find, replacement.replace)
        }
        return next
    }
}

data class HakkaMockRule(
    val id: String,
    val pattern: String,
    val isRegex: Boolean,
    val regexFlags: String?,
    val method: String?,
    val status: Int,
    val headers: Map<String, String>,
    /**
     * Additive, backward-compatible widening of [headers] for header names
     * that carry more than one value on the wire — chiefly `Set-Cookie`,
     * where RFC 6265 §3 forbids folding multiple values into one
     * comma-joined field. Mirrors `MockResponse.headerValues` in
     * `packages/hakka-core/src/engine/MockEngine.ts` and
     * `hakka-network`'s own `MockResponse.headerValues` exactly — vendored
     * here for the same reason as [MockRuleModify]: this module runs its
     * own mock engine ([HakkaMockEngine]) rather than hakka-network's.
     * [HakkaOkHttpClientFactory] applies every value via OkHttp's
     * [okhttp3.Headers.Builder.add], which natively supports more than one
     * value per name.
     */
    val headerValues: Map<String, List<String>> = emptyMap(),
    val body: String,
    val delayMs: Long,
    val enabled: Boolean,
    /** Map Remote: send the real request to a different URL instead of the canned response.
     * Applied on the passthrough-then-transform path. Mirrors `MockRule.redirectTo` in
     * `MockEngine.ts` / `hakka-network`'s `MockRule.redirectTo`. */
    val redirectTo: String? = null,
    /** Abort the matched request with a network-error-shaped failure before it is sent. Takes
     * priority over [redirectTo]/[modify] when true, but [failure] (if present) takes
     * priority over [block]. Mirrors `MockRule.block`. */
    val block: Boolean = false,
    /** Declarative header/query/status/body edits (see [MockRuleModify]). Like [redirectTo],
     * this alone routes the match through the passthrough-then-transform path. */
    val modify: MockRuleModify? = null,
    /** Simulate a specific transport-level failure instead of serving the canned response
     * (see [MockFailure]). Takes priority over [block]. */
    val failure: MockFailure? = null,
    /** Serve the real response for this many initial matches before this rule starts
     * applying. See [HakkaMockEngine.matchRequest] and `MockRule.skipCount` in
     * `MockEngine.ts` for the full semantics — in-memory engine state, reset on relaunch. */
    val skipCount: Int = 0,
    /** After the rule has applied this many times (post-[skipCount]), stop applying it
     * forever. null = unlimited. Mirrors `MockRule.stopAfter`. */
    val stopAfter: Int? = null,
) {
    /**
     * True when this rule is served via the passthrough-then-transform path (issue the real
     * request, then rewrite outgoing URL/headers/query and/or transform incoming
     * status/headers/body) rather than served wholesale from the canned response. Mirrors
     * `MockEngine.ts`'s `isRewrite(rule)`.
     */
    val isRewrite: Boolean get() = redirectTo != null || modify != null
}

data class HakkaMockResponse(
    val status: Int,
    val headers: Map<String, String>,
    /** See [HakkaMockRule.headerValues] — same additive multi-value widening. */
    val headerValues: Map<String, List<String>> = emptyMap(),
    val body: String,
    val delayMs: Long,
)

object HakkaMockEngine {
    private val idCounter = AtomicLong(0)
    private val rules = mutableListOf<HakkaMockRule>()
    private var globalDelayMs: Long = 0L

    /** `skipCount`/`stopAfter` bookkeeping, keyed by rule id — see `MockEngine.kt`'s
     * `matchCounts` for the full rationale. In-memory only, reset on process relaunch. */
    private val matchCounts = HashMap<String, Int>()

    @Synchronized
    fun addBlockRule(pattern: String, status: Int, headers: Map<String, String> = emptyMap(), body: String = ""): String {
        val normalized = pattern.trim()
        val id = "android_mock_${idCounter.incrementAndGet()}_${System.currentTimeMillis()}"
        rules += HakkaMockRule(
            id = id,
            pattern = if (normalized.isEmpty()) ".*" else normalized,
            isRegex = true,
            regexFlags = null,
            method = null,
            status = status,
            headers = headers,
            body = body,
            delayMs = 0L,
            enabled = true,
        )
        return id
    }

    @Synchronized
    fun addRule(
        id: String?,
        pattern: String,
        isRegex: Boolean,
        regexFlags: String?,
        method: String?,
        response: HakkaMockResponse,
        enabled: Boolean,
        redirectTo: String? = null,
        block: Boolean = false,
        modify: MockRuleModify? = null,
        failure: MockFailure? = null,
        skipCount: Int = 0,
        stopAfter: Int? = null,
    ): String {
        val normalized = pattern.trim()
        val ruleId = id?.takeIf { it.isNotBlank() }
            ?: "android_mock_${idCounter.incrementAndGet()}_${System.currentTimeMillis()}"
        rules.removeAll { it.id == ruleId }
        rules += HakkaMockRule(
            id = ruleId,
            pattern = if (normalized.isEmpty()) ".*" else normalized,
            isRegex = isRegex,
            regexFlags = regexFlags,
            method = method?.uppercase(),
            status = response.status,
            headers = response.headers,
            headerValues = response.headerValues,
            body = response.body,
            delayMs = max(0, response.delayMs),
            enabled = enabled,
            redirectTo = redirectTo,
            block = block,
            modify = modify,
            failure = failure,
            skipCount = skipCount,
            stopAfter = stopAfter,
        )
        // A (re-)add always restarts the skip/stop budget — this is a new/edited rule as
        // far as the engine is concerned.
        matchCounts.remove(ruleId)
        return ruleId
    }

    @Synchronized
    fun removeRule(id: String): Boolean {
        val index = rules.indexOfFirst { it.id == id }
        if (index < 0) return false
        rules.removeAt(index)
        matchCounts.remove(id)
        return true
    }

    @Synchronized
    fun clearRules() {
        rules.clear()
        matchCounts.clear()
    }

    @Synchronized
    fun setRuleEnabled(id: String, enabled: Boolean): Boolean {
        val index = rules.indexOfFirst { it.id == id }
        if (index < 0) return false
        val rule = rules[index]
        rules[index] = rule.copy(enabled = enabled)
        return true
    }

    @Synchronized
    fun setGlobalDelay(delayMs: Double) {
        globalDelayMs = max(0L, delayMs.toLong())
    }

    @Synchronized
    fun getGlobalDelayMs(): Long = globalDelayMs

    @Synchronized
    fun matchRequest(url: String, method: String): HakkaMockRule? {
        val normalizedMethod = method.uppercase()
        for (rule in rules) {
            if (!rule.enabled) {
                continue
            }
            if (!methodMatches(rule, normalizedMethod)) {
                continue
            }
            if (urlMatches(rule, url)) {
                // skipCount/stopAfter gate: consumes this rule's match budget.
                // A `false` result means this match should pass through as
                // real, unmodified traffic — treated the same as "no rule
                // matched", not "keep checking other rules" (this IS the
                // matching rule; it just isn't due to apply yet/anymore).
                if (!admitMatch(rule.id, rule.skipCount, rule.stopAfter)) return null
                return rule
            }
        }
        return null
    }

    /**
     * Consumes one unit of a rule's `skipCount`/`stopAfter` budget and decides
     * whether this match should actually be applied. Must be called with the
     * object monitor already held (see [matchRequest], the only caller — this
     * whole object is `@Synchronized`).
     */
    private fun admitMatch(ruleId: String, skipCount: Int, stopAfter: Int?): Boolean {
        val count = (matchCounts[ruleId] ?: 0) + 1
        matchCounts[ruleId] = count

        val skip = max(0, skipCount)
        if (count <= skip) return false

        val appliedIndex = count - skip // 1-based: which applied-match this would be
        if (stopAfter != null && appliedIndex > max(0, stopAfter)) return false

        return true
    }

    private fun methodMatches(rule: HakkaMockRule, requestMethod: String): Boolean {
        if (rule.method == null) return true
        return rule.method == requestMethod
    }

    private fun urlMatches(rule: HakkaMockRule, requestUrl: String): Boolean {
        if (rule.isRegex) {
            return try {
                Pattern.compile(rule.pattern, regexOptions(rule.regexFlags))
                    .matcher(requestUrl)
                    .find()
            } catch (_: PatternSyntaxException) {
                requestUrl.contains(rule.pattern)
            }
        }
        return requestUrl.contains(rule.pattern)
    }

    private fun regexOptions(flags: String?): Int {
        if (flags.isNullOrEmpty()) return 0
        var options = 0
        if (flags.contains('i')) {
            options = options or Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE
        }
        if (flags.contains('m')) {
            options = options or Pattern.MULTILINE
        }
        if (flags.contains('s')) {
            options = options or Pattern.DOTALL
        }
        return options
    }
}
