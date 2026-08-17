package com.noodleapps.hakka

import com.noodleapps.hakka.export.PostmanExporter
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class PostmanExporterTest {

    private fun req(
        method: HttpMethod = HttpMethod.GET,
        url: String = "https://api.example.com/v1/users?page=1",
        requestBody: String? = null,
        requestHeaders: Map<String, List<String>> = mapOf(
            "Accept" to listOf("application/json"),
            "Authorization" to listOf("Bearer tok"),
        ),
        graphqlOperationName: String? = null,
    ) = NetworkRequest(
        id = "1", url = url, method = method,
        status = 200, startTimeMs = 1700000000000L, durationMs = 42,
        requestHeaders = requestHeaders,
        responseHeaders = mapOf("Content-Type" to listOf("application/json")),
        requestBodySize = requestBody?.length?.toLong() ?: 0L, responseBodySize = 10,
        requestBody = requestBody, responseBody = """{"ok":true}""",
        error = null, source = RequestSource.OKHTTP,
        graphqlOperationName = graphqlOperationName,
    )

    @Test
    fun `produces valid v2-1 schema`() {
        val json = JSONObject(PostmanExporter.export(listOf(req())))
        val info = json.getJSONObject("info")
        assertEquals(
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
            info.getString("schema"),
        )
    }

    @Test
    fun `default collection name is Hakka Export`() {
        val json = JSONObject(PostmanExporter.export(listOf(req())))
        assertEquals("Hakka Export", json.getJSONObject("info").getString("name"))
    }

    @Test
    fun `custom collection name is used`() {
        val json = JSONObject(PostmanExporter.export(listOf(req()), name = "My Session"))
        assertEquals("My Session", json.getJSONObject("info").getString("name"))
    }

    @Test
    fun `item contains correct method and name`() {
        val json = JSONObject(PostmanExporter.export(listOf(req(method = HttpMethod.POST,
            url = "https://api.example.com/v1/login"))))
        val item = json.getJSONArray("item").getJSONObject(0)
        assertEquals("POST /v1/login", item.getString("name"))
        assertEquals("POST", item.getJSONObject("request").getString("method"))
    }

    @Test
    fun `headers are exported excluding host`() {
        val json = JSONObject(PostmanExporter.export(listOf(req(
            requestHeaders = mapOf(
                "Accept" to listOf("application/json"),
                "host" to listOf("api.example.com"),
            )
        ))))
        val headers = json.getJSONArray("item").getJSONObject(0)
            .getJSONObject("request").getJSONArray("header")
        val keys = (0 until headers.length()).map { headers.getJSONObject(it).getString("key") }
        assertTrue(keys.contains("Accept"))
        assertFalse(keys.any { it.equals("host", ignoreCase = true) })
    }

    @Test
    fun `request body is included in raw mode`() {
        val body = """{"query":"GetUser","variables":{}}"""
        val json = JSONObject(PostmanExporter.export(listOf(req(
            method = HttpMethod.POST,
            requestBody = body,
            requestHeaders = mapOf("Content-Type" to listOf("application/json")),
        ))))
        val reqObj = json.getJSONArray("item").getJSONObject(0).getJSONObject("request")
        val bodyObj = reqObj.getJSONObject("body")
        assertEquals("raw", bodyObj.getString("mode"))
        assertEquals(body, bodyObj.getString("raw"))
    }

    @Test
    fun `url object has raw and host fields`() {
        val json = JSONObject(PostmanExporter.export(listOf(req())))
        val urlObj = json.getJSONArray("item").getJSONObject(0)
            .getJSONObject("request").getJSONObject("url")
        assertEquals("https://api.example.com/v1/users?page=1", urlObj.getString("raw"))
        val host = urlObj.getJSONArray("host")
        assertTrue(host.length() > 0)
    }

    @Test
    fun `query params are parsed into url object`() {
        val json = JSONObject(PostmanExporter.export(listOf(req(
            url = "https://api.example.com/search?q=hello&limit=10"
        ))))
        val urlObj = json.getJSONArray("item").getJSONObject(0)
            .getJSONObject("request").getJSONObject("url")
        val query = urlObj.optJSONArray("query") ?: throw AssertionError("no query array")
        val keys = (0 until query.length()).map { query.getJSONObject(it).getString("key") }.toSet()
        assertTrue(keys.contains("q"))
        assertTrue(keys.contains("limit"))
    }

    @Test
    fun `empty requests list produces empty item array`() {
        val json = JSONObject(PostmanExporter.export(emptyList()))
        assertEquals(0, json.getJSONArray("item").length())
    }

    @Test
    fun `response array is always empty list`() {
        val json = JSONObject(PostmanExporter.export(listOf(req())))
        val response = json.getJSONArray("item").getJSONObject(0).getJSONArray("response")
        assertEquals(0, response.length())
    }

    @Test
    fun `body language is json for json content type`() {
        val json = JSONObject(PostmanExporter.export(listOf(req(
            method = HttpMethod.POST,
            requestBody = """{"x":1}""",
            requestHeaders = mapOf("Content-Type" to listOf("application/json; charset=utf-8")),
        ))))
        val body = json.getJSONArray("item").getJSONObject(0)
            .getJSONObject("request").getJSONObject("body")
        assertEquals("json", body.getJSONObject("options").getJSONObject("raw").getString("language"))
    }
}
