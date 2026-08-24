package com.noodleapps.hakka

import okio.Buffer
import okio.Source
import okio.Timeout
import okio.buffer
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * [HakkaInterceptor.peekResponseBody] bounds the wait for a response-body peek by wall-clock
 * time, not only by byte count or EOF — see its doc for why. [NeverEndingSource] — a fake
 * [Source] that always has another byte ready (so it never hits EOF) and cooperatively checks
 * its own [Timeout] before every read (matching how OkHttp's AsyncTimeout-backed exchange
 * sources behave) — stands in for a long-lived, low-throughput stream like SSE.
 */
class HakkaInterceptorPeekResponseBodyTest {

    private class NeverEndingSource : Source {
        private val t = Timeout()
        override fun timeout(): Timeout = t
        override fun read(sink: Buffer, byteCount: Long): Long {
            t.throwIfReached()
            // A small per-read delay simulates a slow trickle (SSE heartbeats) — it's what
            // makes "never satisfies byteCount, never hits EOF" realistic, and it keeps a
            // reverted (undeadlined) run's memory growth bounded during this test's window
            // instead of OOMing on an unthrottled tight loop.
            Thread.sleep(20)
            sink.writeByte(0)
            return 1L
        }
        override fun close() {}
    }

    @Test
    fun `bounds the wait on a stream that never reaches maxBodySize or EOF`() {
        val source = NeverEndingSource().buffer()
        val completed = CountDownLatch(1)

        val thread = Thread {
            // At ~20ms/byte this is unreachable within any sane test window, and this
            // source never hits EOF either. A daemon thread so a regression here fails
            // the assertion below instead of hanging the test JVM.
            HakkaInterceptor.peekResponseBody(source, maxBodySize = 10_000_000L)
            completed.countDown()
        }
        thread.isDaemon = true
        thread.start()

        // Before the fix, peekResponseBody calls source.request(maxBodySize) with no
        // deadline set on the source's Timeout, so this loops forever and the latch never
        // counts down.
        assertTrue(
            completed.await(5, TimeUnit.SECONDS),
            "peekResponseBody did not return within the bounded deadline",
        )
    }
}
