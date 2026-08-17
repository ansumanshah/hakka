package com.noodleapps.hakka.benchmark

import okhttp3.OkHttpClient
import org.json.JSONObject

class BenchmarkRuntime(
    val variant: String,
    val client: OkHttpClient,
    private val before: () -> Unit = {},
    private val after: () -> Unit = {},
    private val inspect: () -> JSONObject = { JSONObject() },
    private val closeAction: () -> Unit = {},
) : AutoCloseable {
    fun beforeRun() = before()
    fun afterRun() = after()
    fun snapshot(): JSONObject = inspect()
    override fun close() = closeAction()
}
