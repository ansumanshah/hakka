package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

class RecordSinkTest {
    @Test
    fun `sink hub delivers records in order and isolates failures`() {
        val hub = RecordSinkHub()
        val received = CopyOnWriteArrayList<String>()

        hub.add { record -> received.add((record as NetworkRecord).request.id) }
        hub.add { error("sink failure") }

        hub.emit(record("request-1"))
        hub.emit(record("request-2"))

        assertTrue(hub.flush())
        assertEquals(listOf("request-1", "request-2"), received)
        assertTrue(hub.shutdown())
    }

    @Test
    fun `sink subscription closes delivery`() {
        val hub = RecordSinkHub()
        val received = CopyOnWriteArrayList<String>()
        val subscription = hub.add { record -> received.add((record as NetworkRecord).request.id) }

        hub.emit(record("request-1"))
        assertTrue(hub.flush())
        subscription.close()
        hub.emit(record("request-2"))
        assertTrue(hub.flush())

        assertEquals(listOf("request-1"), received)
        assertTrue(hub.shutdown())
    }

    @Test
    fun `sink hub drops records when pending delivery is full`() {
        val hub = RecordSinkHub(maxPending = 1)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)

        hub.add {
            entered.countDown()
            assertTrue(release.await(2, TimeUnit.SECONDS), "sink should be released")
        }

        hub.emit(record("request-1"))
        assertTrue(entered.await(1, TimeUnit.SECONDS), "sink should start delivery")

        repeat(20) { index ->
            hub.emit(record("request-drop-$index"))
        }

        assertTrue(hub.droppedCount() > 0, "expected bounded sink hub to drop overflow records")
        release.countDown()
        assertTrue(hub.flush())
        assertTrue(hub.shutdown())
    }

    private fun record(id: String): NetworkRecord =
        NetworkRecord.from(
            NetworkRequest(
                id = id,
                url = "https://api.example.com/users",
                method = HttpMethod.GET,
                status = 200,
                startTimeMs = 1_000L,
                durationMs = 10L,
                requestHeaders = emptyMap(),
                responseHeaders = emptyMap(),
                requestBodySize = 0,
                responseBodySize = 0,
                requestBody = null,
                responseBody = null,
                error = null,
                source = RequestSource.OKHTTP,
            ),
            id = id,
            timestampMs = 1_000L,
        )
}
