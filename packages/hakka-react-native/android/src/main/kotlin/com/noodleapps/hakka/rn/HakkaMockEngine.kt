package com.noodleapps.hakka.rn

import kotlin.math.max
import java.util.concurrent.atomic.AtomicLong
import java.util.regex.Pattern
import java.util.regex.PatternSyntaxException
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

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
    val body: String,
    val delayMs: Long,
    val enabled: Boolean,
    /** Map Remote: send the real request to a different URL instead of the canned response.
     * Applied on the passthrough-then-transform path. Mirrors `MockRule.redirectTo` in
     * `MockEngine.ts` / `hakka-network`'s `MockRule.redirectTo`. */
    val redirectTo: String? = null,
    /** Abort the matched request with a network-error-shaped failure before it is sent. Takes
     * priority over [redirectTo]/[modify] when true. Mirrors `MockRule.block`. */
    val block: Boolean = false,
    /** Declarative header/query/status/body edits (see [MockRuleModify]). Like [redirectTo],
     * this alone routes the match through the passthrough-then-transform path. */
    val modify: MockRuleModify? = null,
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
    val body: String,
    val delayMs: Long,
)

object HakkaMockEngine {
    private val idCounter = AtomicLong(0)
    private val rules = mutableListOf<HakkaMockRule>()
    private var globalDelayMs: Long = 0L

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
            body = response.body,
            delayMs = max(0, response.delayMs),
            enabled = enabled,
            redirectTo = redirectTo,
            block = block,
            modify = modify,
        )
        return ruleId
    }

    @Synchronized
    fun removeRule(id: String): Boolean {
        val index = rules.indexOfFirst { it.id == id }
        if (index < 0) return false
        rules.removeAt(index)
        return true
    }

    @Synchronized
    fun clearRules() {
        rules.clear()
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
                return rule
            }
        }
        return null
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
