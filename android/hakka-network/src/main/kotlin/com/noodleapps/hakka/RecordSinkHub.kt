package com.noodleapps.hakka

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

internal class RecordSinkHub(maxPending: Int = 500) : AutoCloseable {
    private val nextId = AtomicLong(1)
    private val dropped = AtomicLong(0)
    private val sinks = ConcurrentHashMap<Long, RecordSink>()
    private val closed = AtomicBoolean(false)
    private val executor = ThreadPoolExecutor(
        1,
        1,
        0L,
        TimeUnit.MILLISECONDS,
        ArrayBlockingQueue(maxPending.coerceAtLeast(1)),
        { runnable -> Thread(runnable, "RecordSink").apply { isDaemon = true } },
        ThreadPoolExecutor.AbortPolicy(),
    )

    fun add(sink: RecordSink): SinkSubscription {
        if (closed.get()) return SinkSubscription {}
        val id = nextId.getAndIncrement()
        sinks[id] = sink
        return SinkSubscription { sinks.remove(id) }
    }

    fun emit(record: ContractRecord) {
        val snapshot = sinks.values.toList()
        if (snapshot.isEmpty()) return

        try {
            executor.execute {
                snapshot.forEach { sink ->
                    runCatching { sink.onRecord(record) }
                }
            }
        } catch (_: RejectedExecutionException) {
            dropped.incrementAndGet()
        }
    }

    fun flush(timeoutMs: Long = 5_000L): Boolean {
        val timeoutNanos = TimeUnit.MILLISECONDS.toNanos(timeoutMs.coerceAtLeast(0))
        val deadline = System.nanoTime() + timeoutNanos

        while (true) {
            val latch = CountDownLatch(1)
            try {
                executor.execute { latch.countDown() }
                val remainingNanos = if (timeoutMs <= 0) 0 else (deadline - System.nanoTime()).coerceAtLeast(0)
                return latch.await(remainingNanos, TimeUnit.NANOSECONDS)
            } catch (_: RejectedExecutionException) {
                if (closed.get()) return true
                if (timeoutMs <= 0 || System.nanoTime() >= deadline) return false
                TimeUnit.MILLISECONDS.sleep(1)
            }
        }
    }

    fun shutdown(timeoutMs: Long = 1_000L): Boolean {
        closed.set(true)
        executor.shutdown()
        return executor.awaitTermination(timeoutMs, TimeUnit.MILLISECONDS)
    }

    fun droppedCount(): Long = dropped.get()

    override fun close() {
        shutdown()
    }
}
