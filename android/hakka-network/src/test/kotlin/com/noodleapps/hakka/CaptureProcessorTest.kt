package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

class CaptureProcessorTest {
    @Test
    fun `processor redacts maps stores and notifies`() {
        val config = HakkaConfig(
            redactHeaders = setOf("authorization"),
            sensitiveQueryItems = setOf("token"),
            sensitiveBodyFields = setOf("password"),
        )
        val store = LogStore(config)
        val captured = mutableListOf<NetworkRequest>()
        val records = mutableListOf<ContractRecord>()
        val processed = CopyOnWriteArrayList<String>()
        val processor = CaptureProcessor(
            configProvider = { config },
            logStore = store,
            listeners = listOf(HakkaListener { captured.add(it) }),
            onRecord = { records.add(it) },
            onProcessed = { processed.add(it) },
        )

        processor.enqueue(
            RawNetworkCapture(
                id = "capture-1",
                url = "https://api.example.com/graphql?token=secret&page=1",
                method = "POST",
                startTimeMs = 100,
                durationMs = 42,
                requestHeaders = mapOf("Authorization" to listOf("Bearer secret")),
                responseHeaders = mapOf("Content-Type" to listOf("application/json")),
                requestBodySize = 95,
                responseBodySize = 11,
                requestContentType = "application/json",
                responseContentType = "application/json",
                requestBody = """{"operationName":"Checkout","password":"secret"}""",
                responseBody = """{"ok":true}""",
                status = 200,
                error = null,
                source = RequestSource.OKHTTP,
                timing = null,
            )
        )

        assertTrue(processor.flush())

        val request = store.all().single()
        assertEquals("capture-1", request.id)
        assertEquals(HttpMethod.POST, request.method)
        assertEquals(200, request.status)
        assertTrue(request.url.contains("token=██"))
        assertTrue(request.url.contains("page=1"))
        assertEquals("██", request.requestHeaders.firstValue("Authorization"))
        assertTrue(request.requestBody!!.contains("Checkout"))
        assertTrue(request.requestBody!!.contains("\"password\":\"██\""))
        assertEquals("Checkout", request.graphqlOperationName)
        assertEquals(request, captured.single())
        val record = records.single() as NetworkRecord
        assertEquals("capture-1", record.id)
        assertEquals("capture-1", record.request.id)
        assertEquals("network.request", record.kind.value)
        assertEquals(listOf("capture-1"), processed)
        assertTrue(processor.close())
    }

    @Test
    fun `flush waits through temporary queue saturation`() {
        val config = HakkaConfig(maxRequests = 1)
        val store = LogStore(config)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val processor = CaptureProcessor(
            configProvider = { config },
            logStore = store,
            listeners = emptyList(),
            onRecord = {
                entered.countDown()
                assertTrue(release.await(2, TimeUnit.SECONDS), "blocked processor should be released")
            },
            onProcessed = {},
        )

        processor.enqueue(capture("active"))
        assertTrue(entered.await(1, TimeUnit.SECONDS), "processor should start active capture")
        processor.enqueue(capture("queued"))

        val started = CountDownLatch(1)
        val flushTask = FutureTask {
            started.countDown()
            processor.flush(timeoutMs = 2_000L)
        }
        Thread(flushTask, "CaptureProcessorFlushTest").start()
        assertTrue(started.await(1, TimeUnit.SECONDS), "flush should start")
        Thread.sleep(50)
        assertFalse(flushTask.isDone, "flush should wait while the queue is temporarily full")

        release.countDown()
        assertTrue(flushTask.get(2, TimeUnit.SECONDS))
        assertTrue(processor.close())
    }

    @Test
    fun `marks overflowed captures as processed when executor queue is full`() {
        val config = HakkaConfig(maxRequests = 1)
        val store = LogStore(config)
        val gate = CountDownLatch(1)
        val processingStarted = CountDownLatch(1)
        val overflowProcessed = CountDownLatch(1)
        val processed = CopyOnWriteArrayList<String>()

        val processor = CaptureProcessor(
            configProvider = { config },
            logStore = store,
            listeners = emptyList(),
            onRecord = {
                processingStarted.countDown()
                assertTrue(gate.await(5, TimeUnit.SECONDS), "processing blocked by test gate")
            },
            onProcessed = { id ->
                processed.add(id)
                if (id == "overflow") overflowProcessed.countDown()
            },
        )

        processor.enqueue(capture("active"))
        assertTrue(processingStarted.await(1, TimeUnit.SECONDS), "first capture should begin processing")
        processor.enqueue(capture("queued"))
        processor.enqueue(capture("overflow"))

        assertTrue(overflowProcessed.await(1, TimeUnit.SECONDS), "overflow capture should be marked processed")
        gate.countDown()
        processor.flush()

        assertTrue(processor.close())
        assertEquals(setOf("active", "queued", "overflow"), processed.toSet())
    }

    private fun capture(id: String): RawNetworkCapture =
        RawNetworkCapture(
            id = id,
            url = "https://api.example.com/users",
            method = "GET",
            startTimeMs = 100,
            durationMs = 42,
            requestHeaders = emptyMap(),
            responseHeaders = emptyMap(),
            requestBodySize = 0,
            responseBodySize = 0,
            requestContentType = null,
            responseContentType = null,
            requestBody = null,
            responseBody = null,
            status = 200,
            error = null,
            source = RequestSource.OKHTTP,
            timing = null,
        )
}
