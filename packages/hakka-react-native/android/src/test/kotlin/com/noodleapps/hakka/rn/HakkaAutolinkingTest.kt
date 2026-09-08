package com.noodleapps.hakka.rn

import com.facebook.react.modules.network.OkHttpClientProvider
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HakkaAutolinkingTest {
    @Test
    fun `autolinking captures only between start and stop while retaining an in-flight response`() {
        NativeCoreDelegate.setCaptureActive(false)
        HakkaMonitorPackage()
        HakkaMonitorPackage()
        val client = OkHttpClientProvider.createClient()
        val interceptor = requireNotNull(NativeCoreDelegate.currentInterceptorPublic())
        interceptor.logStore.clear()
        val server = ServerSocket(0, 3, InetAddress.getByName("127.0.0.1"))
        server.soTimeout = 5_000
        val duringAccepted = CountDownLatch(1)
        val releaseDuring = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        val responses = executor.submit {
            repeat(3) {
                server.accept().use { socket ->
                    socket.soTimeout = 5_000
                    val reader = socket.getInputStream().bufferedReader()
                    val requestLine = reader.readLine()
                    while (!reader.readLine().isNullOrEmpty()) { /* Read the request headers. */ }
                    if (requestLine.contains("/during")) {
                        duringAccepted.countDown()
                        assertTrue(releaseDuring.await(5, TimeUnit.SECONDS))
                    }
                    val body = requestLine.substringAfter("/").substringBefore(" ")
                    val response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n$body"
                    socket.getOutputStream().write(response.toByteArray())
                }
            }
        }

        fun request(path: String) {
            val url = "http://127.0.0.1:${server.localPort}/$path"
            val call = Request.Builder().url(url).header("Authorization", "private-token").build()
            client.newCall(call).execute().use { response ->
                assertEquals(200, response.code)
                response.body!!.string()
            }
        }

        try {
            request("before")
            assertTrue(interceptor.flushCaptureProcessing())
            assertTrue(interceptor.logStore.all().isEmpty())

            NativeCoreDelegate.setCaptureActive(true)
            val inFlight = executor.submit { request("during") }
            assertTrue(duringAccepted.await(5, TimeUnit.SECONDS))
            NativeCoreDelegate.setCaptureActive(false)
            releaseDuring.countDown()
            inFlight.get(5, TimeUnit.SECONDS)

            request("after")
            responses.get(5, TimeUnit.SECONDS)
            assertTrue(interceptor.flushCaptureProcessing())
            val captured = interceptor.logStore.all().single()
            assertTrue(captured.url.endsWith("/during"))
            assertEquals(200, captured.status)
            assertEquals("during", captured.responseBody)
            assertFalse(captured.requestHeaders.values.flatten().contains("private-token"))
        } finally {
            NativeCoreDelegate.setCaptureActive(false)
            releaseDuring.countDown()
            server.close()
            executor.shutdownNow()
            client.connectionPool.evictAll()
            client.dispatcher.executorService.shutdown()
            interceptor.logStore.clear()
        }
    }
}
