package com.noodleapps.hakka

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write

/**
 * Response returned by a matched [MockRule].
 *
 * @property status HTTP status code (default 200).
 * @property headers Response headers (single-value for simplicity).
 * @property body Response body string, or null for empty body.
 * @property delayMs Artificial delay in ms before responding. 0 = instant.
 */
data class MockResponse(
    val status: Int = 200,
    val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
    val delayMs: Long = 0,
)

/**
 * Declarative request/response edits — plain data, no functions, so a rule carrying only a
 * [modify] block is fully serializable and drivable over the control channel
 * ([ControlCommand]'s `mock.add`). Applied on the passthrough-then-transform path (see
 * [HakkaInterceptor.intercept]) and composes with [MockRule.redirectTo].
 *
 * Mirrors `MockRuleModify` in `packages/hakka-core/src/engine/MockEngine.ts` exactly — v1 scope,
 * deliberately narrow: header/query set-or-remove, a response status override, and
 * plain-string (no regex) body find/replace.
 *
 * @property setRequestHeaders Set/overwrite these headers on the outgoing request.
 * @property removeRequestHeaders Remove these headers (case-insensitive) from the outgoing request.
 * @property setQueryParams Set/overwrite these query-string parameters on the outgoing request URL.
 * @property removeQueryParams Remove these query-string parameters from the outgoing request URL.
 * @property status Override the real response's status code.
 * @property setResponseHeaders Set/overwrite these headers on the real response.
 * @property removeResponseHeaders Remove these headers (case-insensitive) from the real response.
 * @property replaceBody Plain-string find/replace pairs applied to the response body, in order.
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
 * `applyQueryEdits` / `applyBodyReplacements` exactly: case-insensitive header removal,
 * exact-key header set, plain-string body find/replace applied in order (empty `find`
 * skipped — it would otherwise be a pathological no-op). No side effects; used by
 * [HakkaInterceptor.intercept]'s passthrough-then-transform path.
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

/**
 * A single mock rule with match criteria and response.
 *
 * @property id Unique rule identifier (generated by [MockEngine]).
 * @property pattern URL pattern — substring match or regex source string.
 * @property isRegex Whether [pattern] is a regex.
 * @property method HTTP method filter. null = match all methods.
 * @property response The mock response to return.
 * @property enabled Whether this rule is active.
 * @property hitCount Number of times this rule has matched.
 * @property redirectTo Map Remote: send the real request to a different URL instead of
 *   [response]. Applied on the passthrough-then-transform path. Mirrors `MockRule.redirectTo`
 *   in `MockEngine.ts`.
 * @property block Abort the matched request with a network-error-shaped failure before it is
 *   sent. Takes priority over [redirectTo]/[modify] when true. Mirrors `MockRule.block`.
 * @property modify Declarative header/query/status/body edits (see [MockRuleModify]). Like
 *   [redirectTo], this alone routes the match through the passthrough-then-transform path.
 */
data class MockRule(
    val id: String,
    val pattern: String,
    val isRegex: Boolean = false,
    val method: String? = null,
    val response: MockResponse,
    var enabled: Boolean = true,
    var hitCount: Int = 0,
    val redirectTo: String? = null,
    val block: Boolean = false,
    val modify: MockRuleModify? = null,
) {
    /**
     * True when this rule is served via the passthrough-then-transform path (issue the
     * real request, then rewrite outgoing URL/headers/query and/or transform incoming
     * status/headers/body) rather than served wholesale from [response]. Mirrors
     * `MockEngine.ts`'s `isRewrite(rule)` — native mock rules carry no `rewriteRequest`/
     * `rewriteResponse` functions (those cannot cross a native bridge), so a rule is a
     * "rewrite" here purely because it declares [redirectTo] and/or [modify].
     */
    val isRewrite: Boolean get() = redirectTo != null || modify != null
}

/**
 * Input for adding a new mock rule.
 *
 * @property id Caller-supplied rule id. When null, [MockEngine] mints one. When an id is
 *   supplied and a rule with that id already exists, [MockEngine.addRule] REPLACES it in
 *   place (replace-by-id) — mirrors the TypeScript `MockEngine.addRule` contract used by
 *   the control-frame bridge (`hakka-core`'s `mock.add`).
 */
data class MockRuleInput(
    val pattern: String,
    val isRegex: Boolean = false,
    val method: String? = null,
    val response: MockResponse,
    val enabled: Boolean = true,
    val id: String? = null,
    val redirectTo: String? = null,
    val block: Boolean = false,
    val modify: MockRuleModify? = null,
)

/**
 * Engine for intercepting network requests and returning mock responses.
 *
 * Thread-safe via [ReentrantReadWriteLock] (consistent with [LogStore] pattern).
 * Regex patterns are compiled lazily and cached.
 *
 * Usage:
 * ```kotlin
 * MockEngine.shared.addRule(MockRuleInput(
 *     pattern = "/api/users",
 *     response = MockResponse(body = """{"users": []}"""),
 * ))
 * ```
 */
class MockEngine {
    companion object {
        /** Singleton shared by interceptors. */
        val shared = MockEngine()
    }

    private val rules = mutableListOf<MockRule>()
    private val lock = ReentrantReadWriteLock()
    private val idCounter = AtomicInteger(0)

    private val regexCache = HashMap<String, Regex>()

    // Change listeners — mirrors BreakpointEngine.subscribe (hakka-common). Added so
    // MocksPanel (hakka-ui) can refresh immediately on rule add/remove/enable/disable
    // instead of waiting out its poll tick, notably right after DetailActivity's
    // "Mock this" action writes a rule into this singleton from underneath the panel.
    private val listeners = mutableListOf<() -> Unit>()
    private val listenersLock = Any()

    /**
     * Adds a mock rule. Returns the rule id (either [MockRuleInput.id] when supplied, or a
     * freshly generated one). Adding with an id that already exists REPLACES that rule in
     * place (replace-by-id) rather than creating a duplicate.
     */
    fun addRule(input: MockRuleInput): String {
        val id = input.id ?: "mock_${idCounter.incrementAndGet()}_${System.currentTimeMillis()}"
        val rule = MockRule(
            id = id,
            pattern = input.pattern,
            isRegex = input.isRegex,
            method = input.method,
            response = input.response,
            enabled = input.enabled,
            redirectTo = input.redirectTo,
            block = input.block,
            modify = input.modify,
        )
        lock.write {
            val existingIndex = rules.indexOfFirst { it.id == id }
            if (existingIndex >= 0) {
                rules[existingIndex] = rule
            } else {
                rules.add(rule)
            }
        }
        notifyListeners()
        return id
    }

    /** Removes a rule by id. */
    fun removeRule(id: String) {
        lock.write { rules.removeAll { it.id == id } }
        // No need to evict regex cache — stale entries are harmless and bounded
        notifyListeners()
    }

    /** Enables a rule by id. */
    fun enableRule(id: String) {
        lock.write { rules.find { it.id == id }?.enabled = true }
        notifyListeners()
    }

    /** Disables a rule by id. */
    fun disableRule(id: String) {
        lock.write { rules.find { it.id == id }?.enabled = false }
        notifyListeners()
    }

    /** Returns a snapshot of all rules. */
    fun getRules(): List<MockRule> = lock.read { rules.toList() }

    /** Removes all rules and clears regex cache. */
    fun clearRules() {
        lock.write {
            rules.clear()
            regexCache.clear()
        }
        notifyListeners()
    }

    // ── Listeners ─────────────────────────────────────────────────────────────

    /**
     * Subscribe to rule-list changes (add/remove/enable/disable/clear). The listener is
     * called on whichever thread made the change. Returns an unsubscribe lambda. Mirrors
     * [com.noodleapps.hakka.BreakpointEngine.subscribe].
     */
    fun subscribe(listener: () -> Unit): () -> Unit {
        synchronized(listenersLock) { listeners.add(listener) }
        return { synchronized(listenersLock) { listeners.remove(listener) } }
    }

    private fun notifyListeners() {
        val snapshot = synchronized(listenersLock) { listeners.toList() }
        snapshot.forEach { it() }
    }

    /**
     * Called by [HakkaInterceptor.intercept] — returns the first matching enabled rule, or null.
     * Increments [MockRule.hitCount] on match.
     */
    fun match(url: String, method: String): MockRule? = lock.write {
        for (rule in rules) {
            if (!rule.enabled) continue

            if (rule.method != null && !rule.method.equals(method, ignoreCase = true)) continue

            val matched = if (rule.isRegex) {
                val regex = regexCache.getOrPut(rule.pattern) {
                    runCatching { Regex(rule.pattern) }.getOrNull() ?: continue
                }
                regex.containsMatchIn(url)
            } else {
                url.contains(rule.pattern)
            }
            if (!matched) continue

            rule.hitCount++
            return@write rule
        }
        null
    }
}
