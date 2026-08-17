package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class StorageAdapterTest {

    private fun req(
        id: String = "id-1",
        method: HttpMethod = HttpMethod.GET,
        status: Int? = 200,
        url: String = "https://example.com/api",
        startTimeMs: Long = 1_000L,
    ) = NetworkRequest(
        id = id, url = url, method = method,
        status = status, startTimeMs = startTimeMs, durationMs = 10,
        requestHeaders = emptyMap(), responseHeaders = emptyMap(),
        requestBodySize = 0, responseBodySize = 0,
        requestBody = null, responseBody = null,
        error = null, source = RequestSource.OKHTTP,
    )

    @Test
    fun `store and count`() {
        val storage = InMemoryStorage(HakkaConfig())
        storage.store(req("a"))
        storage.store(req("b"))
        assertEquals(2, storage.count)
    }

    @Test
    fun `clear empties storage`() {
        val storage = InMemoryStorage(HakkaConfig())
        storage.store(req())
        storage.clear()
        assertEquals(0, storage.count)
        assertEquals(0, storage.query(RequestFilter()).size)
    }

    @Test
    fun `query with no filter returns all`() {
        val storage = InMemoryStorage(HakkaConfig())
        repeat(3) { storage.store(req("id-$it")) }
        assertEquals(3, storage.query(RequestFilter()).size)
    }

    @Test
    fun `query filters by url pattern`() {
        val storage = InMemoryStorage(HakkaConfig())
        storage.store(req("a", url = "https://api.example.com/users"))
        storage.store(req("b", url = "https://api.example.com/posts"))
        storage.store(req("c", url = "https://other.com/health"))
        val results = storage.query(RequestFilter(urlPattern = "example.com"))
        assertEquals(2, results.size)
    }

    @Test
    fun `query filters by method`() {
        val storage = InMemoryStorage(HakkaConfig())
        storage.store(req("a", method = HttpMethod.GET))
        storage.store(req("b", method = HttpMethod.POST))
        storage.store(req("c", method = HttpMethod.POST))
        val results = storage.query(RequestFilter(method = "POST"))
        assertEquals(2, results.size)
    }

    @Test
    fun `query filters by status range`() {
        val storage = InMemoryStorage(HakkaConfig())
        storage.store(req("a", status = 200))
        storage.store(req("b", status = 404))
        storage.store(req("c", status = 500))
        storage.store(req("d", status = null))
        val errors = storage.query(RequestFilter(statusRange = 400..599))
        assertEquals(2, errors.size)
    }

    @Test
    fun `query filters by since`() {
        val storage = InMemoryStorage(HakkaConfig())
        storage.store(req("old", startTimeMs = 500L))
        storage.store(req("recent", startTimeMs = 2_000L))
        val results = storage.query(RequestFilter(since = 1_000L))
        assertEquals(1, results.size)
        assertEquals("recent", results[0].id)
    }

    @Test
    fun `query with status filter skips null status`() {
        val storage = InMemoryStorage(HakkaConfig())
        storage.store(req("no-status", status = null))
        val results = storage.query(RequestFilter(statusRange = 200..299))
        assertEquals(0, results.size)
    }
}

class RequestFilterTest {
    private fun req(
        url: String = "https://api.example.com/users",
        method: HttpMethod = HttpMethod.GET,
        status: Int? = 200,
        startTimeMs: Long = 1_000L,
    ) = NetworkRequest(
        id = "id", url = url, method = method,
        status = status, startTimeMs = startTimeMs, durationMs = 10,
        requestHeaders = emptyMap(), responseHeaders = emptyMap(),
        requestBodySize = 0, responseBodySize = 0,
        requestBody = null, responseBody = null,
        error = null, source = RequestSource.OKHTTP,
    )

    @Test
    fun `empty filter matches everything`() {
        assertTrue(RequestFilter().matches(req()))
    }

    @Test
    fun `urlPattern match`() {
        assertTrue(RequestFilter(urlPattern = "example.com").matches(req()))
        assertFalse(RequestFilter(urlPattern = "other.com").matches(req()))
    }

    @Test
    fun `method match`() {
        assertTrue(RequestFilter(method = "GET").matches(req()))
        assertFalse(RequestFilter(method = "POST").matches(req()))
    }

    @Test
    fun `statusRange match`() {
        assertTrue(RequestFilter(statusRange = 200..299).matches(req(status = 200)))
        assertFalse(RequestFilter(statusRange = 200..299).matches(req(status = 404)))
        assertFalse(RequestFilter(statusRange = 200..299).matches(req(status = null)))
    }

    @Test
    fun `since match`() {
        assertTrue(RequestFilter(since = 500L).matches(req(startTimeMs = 1_000L)))
        assertFalse(RequestFilter(since = 2_000L).matches(req(startTimeMs = 1_000L)))
    }

    @Test
    fun `combined filters all must pass`() {
        val filter = RequestFilter(urlPattern = "example.com", method = "GET", statusRange = 200..299)
        assertTrue(filter.matches(req()))
        assertFalse(filter.matches(req(method = HttpMethod.POST)))
        assertFalse(filter.matches(req(status = 500)))
        assertFalse(filter.matches(req(url = "https://other.com/path")))
    }
}
