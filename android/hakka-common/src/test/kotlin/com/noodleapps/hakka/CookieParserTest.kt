package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ParseRequestCookiesTest {
    @Test
    fun `returns empty for null input`() {
        assertEquals(emptyList<RequestCookie>(), parseRequestCookies(null))
    }

    @Test
    fun `returns empty for blank input`() {
        assertEquals(emptyList<RequestCookie>(), parseRequestCookies("   "))
    }

    @Test
    fun `parses single cookie`() {
        val cookies = parseRequestCookies("session=abc123")
        assertEquals(1, cookies.size)
        assertEquals("session", cookies[0].name)
        assertEquals("abc123", cookies[0].value)
    }

    @Test
    fun `parses multiple cookies`() {
        val cookies = parseRequestCookies("a=1; b=2; c=3")
        assertEquals(3, cookies.size)
        assertEquals("a", cookies[0].name); assertEquals("1", cookies[0].value)
        assertEquals("b", cookies[1].name); assertEquals("2", cookies[1].value)
        assertEquals("c", cookies[2].name); assertEquals("3", cookies[2].value)
    }

    @Test
    fun `handles cookie without value`() {
        val cookies = parseRequestCookies("flagonly")
        assertEquals(1, cookies.size)
        assertEquals("flagonly", cookies[0].name)
        assertEquals("", cookies[0].value)
    }

    @Test
    fun `handles value containing equals sign`() {
        val cookies = parseRequestCookies("token=a=b=c")
        assertEquals(1, cookies.size)
        assertEquals("token", cookies[0].name)
        assertEquals("a=b=c", cookies[0].value)
    }

    @Test
    fun `trims whitespace around names and values`() {
        val cookies = parseRequestCookies("  x = hello ")
        assertEquals(1, cookies.size)
        assertEquals("x", cookies[0].name)
        assertEquals("hello", cookies[0].value)
    }
}

class ParseSetCookieTest {
    @Test
    fun `returns empty for empty list`() {
        assertEquals(emptyList<ParsedCookie>(), parseSetCookie(emptyList()))
    }

    @Test
    fun `parses simple name=value`() {
        val cookies = parseSetCookie(listOf("id=42"))
        assertEquals(1, cookies.size)
        assertEquals("id", cookies[0].name)
        assertEquals("42", cookies[0].value)
        assertFalse(cookies[0].httpOnly)
        assertFalse(cookies[0].secure)
        assertNull(cookies[0].sameSite)
    }

    @Test
    fun `parses full attributes`() {
        val cookies = parseSetCookie(listOf(
            "session=xyz; Domain=example.com; Path=/; Expires=Thu, 01 Jan 2099 00:00:00 GMT; Max-Age=86400; HttpOnly; Secure; SameSite=Strict"
        ))
        val c = cookies[0]
        assertEquals("session", c.name)
        assertEquals("xyz", c.value)
        assertEquals("example.com", c.domain)
        assertEquals("/", c.path)
        assertEquals("Thu, 01 Jan 2099 00:00:00 GMT", c.expires)
        assertEquals(86400L, c.maxAge)
        assertTrue(c.httpOnly)
        assertTrue(c.secure)
        assertEquals(ParsedCookie.SameSite.Strict, c.sameSite)
    }

    @Test
    fun `parses SameSite=Lax case-insensitively`() {
        val cookies = parseSetCookie(listOf("x=1; samesite=lax"))
        assertEquals(ParsedCookie.SameSite.Lax, cookies[0].sameSite)
    }

    @Test
    fun `parses SameSite=None`() {
        val cookies = parseSetCookie(listOf("x=1; SameSite=None"))
        assertEquals(ParsedCookie.SameSite.None, cookies[0].sameSite)
    }

    @Test
    fun `parses multiple Set-Cookie headers`() {
        val cookies = parseSetCookie(listOf("a=1; Path=/", "b=2; Secure; HttpOnly"))
        assertEquals(2, cookies.size)
        assertEquals("a", cookies[0].name); assertFalse(cookies[0].secure)
        assertEquals("b", cookies[1].name); assertTrue(cookies[1].secure); assertTrue(cookies[1].httpOnly)
    }

    @Test
    fun `unknown attributes are ignored gracefully`() {
        val cookies = parseSetCookie(listOf("x=1; Unknown=yes; Invented=blah"))
        assertEquals("x", cookies[0].name)
        assertEquals("1", cookies[0].value)
    }

    @Test
    fun `handles cookie with equals in value`() {
        val cookies = parseSetCookie(listOf("token=abc==; Path=/"))
        assertEquals("token", cookies[0].name)
        assertEquals("abc==", cookies[0].value)
    }
}
