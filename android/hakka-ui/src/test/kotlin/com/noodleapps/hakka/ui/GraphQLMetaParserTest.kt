package com.noodleapps.hakka.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class GraphQLMetaParserTest {

    @Test
    fun `extracts query text, operation type, and pretty variables from a standard body`() {
        val body = """{"operationName":"GetUser","query":"query GetUser(${'$'}id: ID!) { user(id: ${'$'}id) { name } }","variables":{"id":"42"}}"""
        val meta = GraphQLMetaParser.parse(body, null, knownOperationName = null)

        assertEquals("query", meta.operationType)
        assertEquals("GetUser", meta.operationName)
        assertEquals("query GetUser(\$id: ID!) { user(id: \$id) { name } }", meta.query)
        assertEquals("{\"id\": \"42\"}", meta.variables)
    }

    @Test
    fun `detects mutation and subscription operation types from the query keyword`() {
        val mutation = GraphQLMetaParser.parse("""{"query":"mutation CreatePost { createPost { id } }"}""", null, null)
        assertEquals("mutation", mutation.operationType)

        val subscription = GraphQLMetaParser.parse("""{"query":"subscription OnPost { onPost { id } }"}""", null, null)
        assertEquals("subscription", subscription.operationType)
    }

    @Test
    fun `a persisted query with no query field yields null query and operationType`() {
        // Persisted-query clients (APQ) send operationName + extensions.persistedQuery
        // instead of a `query` string — must not crash and must not fabricate a type.
        val body = """{"operationName":"GetUser","variables":{"id":"1"},"extensions":{"persistedQuery":{"sha256Hash":"abc"}}}"""
        val meta = GraphQLMetaParser.parse(body, null, knownOperationName = null)

        assertEquals("GetUser", meta.operationName)
        assertNull(meta.query)
        assertNull(meta.operationType)
        assertEquals("{\"id\": \"1\"}", meta.variables)
    }

    @Test
    fun `a body truncated by maxBodySize (invalid JSON) is dropped without throwing`() {
        val truncated = """{"operationName":"GetUser","query":"query GetUser { user { name, em"""
        val meta = GraphQLMetaParser.parse(truncated, null, knownOperationName = null)

        assertNull(meta.query)
        assertNull(meta.operationType)
        assertNull(meta.operationName)
    }

    @Test
    fun `null request and response bodies yield an all-null meta without throwing`() {
        val meta = GraphQLMetaParser.parse(null, null, knownOperationName = null)

        assertNull(meta.operationType)
        assertNull(meta.operationName)
        assertNull(meta.query)
        assertNull(meta.variables)
        assertNull(meta.errors)
    }

    @Test
    fun `knownOperationName from the engine wins over a body operationName field`() {
        val body = """{"operationName":"FromBody","query":"query FromBody { x }"}"""
        val meta = GraphQLMetaParser.parse(body, null, knownOperationName = "FromEngine")

        assertEquals("FromEngine", meta.operationName)
    }

    @Test
    fun `response errors array is captured, and an empty or missing errors array yields null`() {
        val withErrors = GraphQLMetaParser.parse(null, """{"data":null,"errors":[{"message":"boom"}]}""", null)
        assertEquals("[{\"message\": \"boom\"}]", withErrors.errors)

        val emptyErrors = GraphQLMetaParser.parse(null, """{"data":{"x":1},"errors":[]}""", null)
        assertNull(emptyErrors.errors)

        val noErrorsField = GraphQLMetaParser.parse(null, """{"data":{"x":1}}""", null)
        assertNull(noErrorsField.errors)
    }
}
