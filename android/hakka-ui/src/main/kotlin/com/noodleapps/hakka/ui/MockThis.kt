package com.noodleapps.hakka.ui

import com.noodleapps.hakka.MockResponse
import com.noodleapps.hakka.MockRuleInput
import com.noodleapps.hakka.NetworkRequest
import java.net.URL

/**
 * "Mock this" — derives a [MockRuleInput] from an already-captured [NetworkRequest],
 * mirroring core's `mockFromTraffic.ts` (record, then mock): pattern is the URL
 * path+query with the host stripped, so a mock recorded against one host keeps
 * matching after pointing the app at a different host/tunnel. Only the
 * `content-type` response header is carried over onto the mocked response.
 *
 * Pure function — no MockEngine/Android dependency — so it's unit-testable and
 * reusable by [DetailActivity]'s "Mock this" button.
 *
 * @return null when the request has nothing usable to replay (no status AND no
 *   response body).
 */
fun deriveMockRule(request: NetworkRequest): MockRuleInput? {
    if (request.status == null && request.responseBody == null) return null

    val pattern = try {
        val u = URL(request.url)
        u.path + (u.query?.let { "?$it" } ?: "")
    } catch (_: Exception) {
        request.url
    }

    val contentType = request.responseHeaders.entries
        .firstOrNull { it.key.equals("content-type", ignoreCase = true) }
        ?.value?.firstOrNull()

    return MockRuleInput(
        pattern = pattern,
        method = request.method.name,
        response = MockResponse(
            status = request.status ?: 200,
            headers = contentType?.let { mapOf("content-type" to it) } ?: emptyMap(),
            body = request.responseBody,
        ),
        enabled = true,
    )
}
