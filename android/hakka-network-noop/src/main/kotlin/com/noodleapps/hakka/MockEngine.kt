package com.noodleapps.hakka

/**
 * Response returned by a matched [MockRule].
 * No-op variant — same API surface, all operations are no-ops.
 */
data class MockResponse(
    val status: Int = 200,
    val headers: Map<String, String> = emptyMap(),
    val headerValues: Map<String, List<String>> = emptyMap(),
    val body: String? = null,
    val delayMs: Long = 0,
)

/** No-op counterpart of the network mock failure codes. */
enum class MockFailureCode(val wireValue: String) {
    TIMEOUT("timeout"),
    NO_CONNECTION("noConnection"),
    CANNOT_FIND_HOST("cannotFindHost"),
    CANNOT_CONNECT_TO_HOST("cannotConnectToHost"),
    CONNECTION_LOST("connectionLost"),
    SECURE_CONNECTION_FAILED("secureConnectionFailed"),
    CANCELLED("cancelled"),
    UNKNOWN("unknown");

    companion object {
        fun fromWireValue(value: String): MockFailureCode? = entries.firstOrNull { it.wireValue == value }
    }
}

/** No-op counterpart of a transport-failure mock rule. */
data class MockFailure(val code: MockFailureCode)

/**
 * Declarative request/response edits — same shape as the real `MockRuleModify` in
 * `hakka-network`, so consumer code compiles unchanged when swapping build flavors.
 * No-op variant: this module never applies these edits.
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
 * No-op [MockRuleTransform] — same public API as `hakka-network`'s edit-application helpers,
 * but every function is an identity/no-op so consumer code compiles unchanged when swapping
 * build flavors.
 */
object MockRuleTransform {
    fun applyHeaderEdits(
        headers: Map<String, String>,
        set: Map<String, String>?,
        remove: List<String>?,
    ): Map<String, String> = headers

    fun applyQueryEdits(url: String, set: Map<String, String>?, remove: List<String>?): String = url

    fun applyBodyReplacements(body: String, replacements: List<MockRuleModify.BodyReplacement>?): String = body
}

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
    val regexFlags: String? = null,
) {
    val isRewrite: Boolean get() = redirectTo != null || modify != null
}

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
    val regexFlags: String? = null,
)

/**
 * No-op [MockEngine] — same public API, all methods are no-ops.
 * Swap by dependency name (`hakka-network-noop` instead of `hakka-network`).
 */
class MockEngine {
    companion object {
        val shared = MockEngine()
    }

    fun addRule(input: MockRuleInput): String = ""
    fun removeRule(id: String) {}
    fun enableRule(id: String) {}
    fun disableRule(id: String) {}
    fun getRules(): List<MockRule> = emptyList()
    fun clearRules() {}
    fun match(url: String, method: String): MockRule? = null
}
