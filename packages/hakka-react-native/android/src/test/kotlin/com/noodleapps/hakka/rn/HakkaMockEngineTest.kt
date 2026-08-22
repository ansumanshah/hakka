package com.noodleapps.hakka.rn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class HakkaMockEngineTest {
  @Before
  fun setup() {
    HakkaMockEngine.clearRules()
    HakkaMockEngine.setGlobalDelay(0.0)
  }

  @Test
  fun addBlockRule_matchesAllMethodsAndUpdatesDelayAndId() {
    val id = HakkaMockEngine.addBlockRule(
      pattern = "api.example.com/block",
      status = 503,
      headers = mapOf("x-test" to "1"),
      body = """{"blocked":true}""",
    )

    val rule = HakkaMockEngine.matchRequest("https://api.example.com/block/me", "GET")

    assertNotNull(rule)
    requireNotNull(rule)
    assertEquals(id, rule.id)
    assertEquals(503, rule.status)
    assertEquals("1", rule.headers["x-test"])
    assertEquals("""{"blocked":true}""", rule.body)
    assertEquals(0L, rule.delayMs)
  }

  @Test
  fun addRule_withMethodAndRegexRespectsMethodFilter() {
    val getRule = HakkaMockEngine.addRule(
      id = null,
      pattern = "https://api.example.com/.*",
      isRegex = true,
      regexFlags = null,
      method = "GET",
      response = HakkaMockResponse(
        status = 200,
        headers = emptyMap(),
        body = "get ok",
        delayMs = 12,
      ),
      enabled = true,
    )

    HakkaMockEngine.addRule(
      id = null,
      pattern = "https://api.example.com/.*",
      isRegex = true,
      regexFlags = null,
      method = "POST",
      response = HakkaMockResponse(
        status = 201,
        headers = emptyMap(),
        body = "post ok",
        delayMs = 0,
      ),
      enabled = true,
    )

    val matchedGet = HakkaMockEngine.matchRequest("https://api.example.com/users", "GET")
    val matchedPost = HakkaMockEngine.matchRequest("https://api.example.com/users", "POST")
    val matchedPut = HakkaMockEngine.matchRequest("https://api.example.com/users", "PUT")

    assertNotNull(matchedGet)
    requireNotNull(matchedGet)
    assertEquals(getRule, matchedGet.id)
    assertEquals("get ok", matchedGet.body)
    assertEquals(12L, matchedGet.delayMs)

    assertNotNull(matchedPost)
    requireNotNull(matchedPost)
    assertEquals("post ok", matchedPost.body)

    assertNull(matchedPut)
  }

  @Test
  fun addRuleFallsBackToContainsMatchWhenInvalidRegexProvided() {
    HakkaMockEngine.addRule(
      id = null,
      pattern = "(",
      isRegex = true,
      regexFlags = null,
      method = null,
      response = HakkaMockResponse(
        status = 418,
        headers = emptyMap(),
        body = "invalid regex fallback",
        delayMs = 0,
      ),
      enabled = true,
    )

    val matched = HakkaMockEngine.matchRequest("https://api.example.com/path(with-paren)", "GET")

    assertNotNull(matched)
    requireNotNull(matched)
    assertEquals(418, matched.status)
    assertEquals("invalid regex fallback", matched.body)
  }

  // Regression: `headerValues` is the additive multi-value widening of `headers` (see
  // HakkaMockRule.headerValues's doc) — two Set-Cookie values survive addRule -> matchRequest
  // distinctly, and `headers` still carries the representative first value.
  @Test
  fun addRule_carriesHeaderValuesThroughToMatchedRule() {
    HakkaMockEngine.addRule(
      id = null,
      pattern = "https://api.example.com/login",
      isRegex = false,
      regexFlags = null,
      method = null,
      response = HakkaMockResponse(
        status = 200,
        headers = mapOf("Set-Cookie" to "session=abc"),
        headerValues = mapOf("Set-Cookie" to listOf("session=abc; Path=/", "consent=yes; Path=/")),
        body = "",
        delayMs = 0,
      ),
      enabled = true,
    )

    val matched = HakkaMockEngine.matchRequest("https://api.example.com/login", "GET")

    assertNotNull(matched)
    requireNotNull(matched)
    assertEquals("session=abc", matched.headers["Set-Cookie"])
    assertEquals(listOf("session=abc; Path=/", "consent=yes; Path=/"), matched.headerValues["Set-Cookie"])
  }

  @Test
  fun globalDelayAndRuleLifecycle() {
    HakkaMockEngine.setGlobalDelay(250.0)
    assertEquals(250L, HakkaMockEngine.getGlobalDelayMs())

    val id = HakkaMockEngine.addRule(
      id = null,
      pattern = "api.example.com/clear",
      isRegex = false,
      regexFlags = null,
      method = null,
      response = HakkaMockResponse(
        status = 200,
        headers = emptyMap(),
        body = "ok",
        delayMs = 0,
      ),
      enabled = true,
    )

    val matched = HakkaMockEngine.matchRequest("https://api.example.com/clear", "GET")
    assertNotNull(matched)
    assertEquals("ok", matched?.body)

    HakkaMockEngine.removeRule(id)
    assertNull(HakkaMockEngine.matchRequest("https://api.example.com/clear", "GET"))

    HakkaMockEngine.clearRules()
    assertNull(HakkaMockEngine.matchRequest("https://api.example.com/clear", "GET"))
  }
}
