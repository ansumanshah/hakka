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
/**
 * Platform-neutral transport-error codes for a [failure]-mode rule. Mirrors
 * `MockFailureCode` in `packages/hakka-core/src/engine/MockEngine.ts` — the
 * source of truth; read it there for the full cross-runtime mapping table.
 * Maps onto the [IOException] subtype this engine actually throws (see
 * [HakkaInterceptor.intercept]'s failure branch).
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
 * Simulates a transport-level failure — the request never gets a real
 * response — rather than serving [MockResponse]. Mirrors `MockFailure` in
 * `MockEngine.ts`. Precedence: [failure] is checked before `block`, which is
 * checked before the rewrite path (`redirectTo`/`modify`), which is checked
 * before a plain mock response.
 */
data class MockFailure(val code: MockFailureCode)

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
 *   sent. Takes priority over [redirectTo]/[modify] when true, but [failure] (if present)
 *   takes priority over [block]. Mirrors `MockRule.block`.
 * @property modify Declarative header/query/status/body edits (see [MockRuleModify]). Like
 *   [redirectTo], this alone routes the match through the passthrough-then-transform path.
 * @property failure Simulate a specific transport-level failure instead of serving [response]
 *   (see [MockFailure]). Takes priority over [block].
 * @property skipCount Serve the real response for this many initial matches before this rule
 *   starts applying. See [MockEngine.match] and `MockRule.skipCount` in `MockEngine.ts` for
 *   the full semantics — the counter is in-memory engine state, reset on process relaunch.
 * @property stopAfter After the rule has applied this many times (post-[skipCount]), stop
 *   applying it forever. null = unlimited. Mirrors `MockRule.stopAfter`.
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
    val failure: MockFailure? = null,
    val skipCount: Int = 0,
    val stopAfter: Int? = null,
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
    val failure: MockFailure? = null,
    val skipCount: Int = 0,
    val stopAfter: Int? = null,
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

    /**
     * `skipCount`/`stopAfter` bookkeeping, keyed by rule id — see
     * `matchCountsById` in `MockEngine.ts` for the full rationale. In-memory
     * only, reset on process relaunch, and reset per-rule whenever that rule
     * is (re-)added — see [addRule]/[removeRule]/[clearRules].
     */
    private val matchCounts = HashMap<String, Int>()

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
            failure = input.failure,
            skipCount = input.skipCount,
            stopAfter = input.stopAfter,
        )
        lock.write {
            val existingIndex = rules.indexOfFirst { it.id == id }
            if (existingIndex >= 0) {
                rules[existingIndex] = rule
            } else {
                rules.add(rule)
            }
            // A (re-)add always restarts the skip/stop budget — this is a
            // new/edited rule as far as the engine is concerned.
            matchCounts.remove(id)
        }
        notifyListeners()
        return id
    }

    /** Removes a rule by id. */
    fun removeRule(id: String) {
        lock.write {
            rules.removeAll { it.id == id }
            matchCounts.remove(id)
        }
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
            matchCounts.clear()
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
     * Called by [HakkaInterceptor.intercept] — returns the first matching enabled rule that
     * is currently due to apply (see [admitMatch]), or null. Increments [MockRule.hitCount]
     * only on a rule that is actually returned/applied.
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

            // skipCount/stopAfter gate: consumes this rule's match budget. A
            // `false` result means this match should pass through as real,
            // unmodified traffic — treated the same as "no rule matched",
            // not "keep checking other rules" (this IS the matching rule; it
            // just isn't due to apply yet/anymore).
            if (!admitMatch(rule.id, rule.skipCount, rule.stopAfter)) return@write null

            rule.hitCount++
            return@write rule
        }
        null
    }

    /**
     * Consumes one unit of a rule's `skipCount`/`stopAfter` budget and decides
     * whether this match should actually be applied. Must be called with
     * [lock] already held for write (see [match], the only caller).
     */
    private fun admitMatch(ruleId: String, skipCount: Int, stopAfter: Int?): Boolean {
        val count = (matchCounts[ruleId] ?: 0) + 1
        matchCounts[ruleId] = count

        val skip = maxOf(0, skipCount)
        if (count <= skip) return false

        val appliedIndex = count - skip // 1-based: which applied-match this would be
        if (stopAfter != null && appliedIndex > maxOf(0, stopAfter)) return false

        return true
    }
}
