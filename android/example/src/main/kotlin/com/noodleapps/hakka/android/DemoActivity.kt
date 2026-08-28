package com.noodleapps.hakka.android

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.noodleapps.hakka.BreakpointEngine
import com.noodleapps.hakka.BreakpointPhase
import com.noodleapps.hakka.BreakpointRuleInput
import com.noodleapps.hakka.HakkaInterceptor
import com.noodleapps.hakka.HakkaWebSocketWrapper
import com.noodleapps.hakka.MockEngine
import com.noodleapps.hakka.MockFailure
import com.noodleapps.hakka.MockFailureCode
import com.noodleapps.hakka.MockResponse
import com.noodleapps.hakka.MockRuleInput
import com.noodleapps.hakka.MockRuleModify
import com.noodleapps.hakka.ThrottleEngine
import com.noodleapps.hakka.ThrottleProfile
import com.noodleapps.hakka.ui.Hakka
import com.noodleapps.hakka.ui.HakkaUI
import com.noodleapps.hakka.ui.Theme
import com.noodleapps.hakka.ui.addRipple
import com.noodleapps.hakka.ui.brand.AppIconView
import com.noodleapps.hakka.ui.dp
import com.noodleapps.hakka.ui.methodChip
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException

/**
 * Hakka demo + traffic generator. Exists to exercise the inspector panels with real
 * traffic — not a showcase app in its own right — so its own chrome is deliberately
 * simple, but it's still a *Wok Hei* screen: same tokens, same method-chip grammar,
 * same accent discipline as the inspector it launches, not an unrelated palette.
 *
 * Inlines [Hakka.install] instead of the shorter `OkHttpClient.Builder.installHakka()`
 * one-liner only to keep a reference to the built [HakkaInterceptor] around, for the
 * WebSocket capture section below (`interceptor.logStore`). Most host apps should
 * reach for `installHakka()` directly; this is a demo-only wrinkle.
 */
class DemoActivity : Activity() {

    private lateinit var client: OkHttpClient
    private lateinit var interceptor: HakkaInterceptor
    private var requestCount = 0
    private lateinit var countText: TextView

    private var notificationsDenied = false
    private lateinit var permissionNoteText: TextView

    private var wsCapture: HakkaWebSocketWrapper? = null
    private var prefsSessionCount = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Capture + the auto-launcher notification + shake-to-open, plus redaction for
        // the "token"/"password"/"secret" fields the Mock/Auth/Storage sections below
        // deliberately use. The same redaction rule reaches request bodies, query
        // params, and the Storage tab's SharedPreferences dump alike.
        // perfMonitoring = true also starts native FPS/jank/memory/CPU monitoring,
        // rendered live in the inspector's Stats tab.
        interceptor = Hakka.install(this, perfMonitoring = true) {
            sensitiveBodyFields = setOf("token", "password", "secret")
        }
        client = OkHttpClient.Builder()
            .addInterceptor(interceptor)
            .apply { interceptor.eventListenerFactory()?.let { eventListenerFactory(it) } }
            .build()

        // POST_NOTIFICATIONS is a runtime permission on API 33+. Without asking for it
        // here, the auto-launcher notification silently never appears and nothing tells
        // the user why. Every other entry point (Fullscreen/Sheet/Bubble/shake) works
        // regardless, so a decline degrades the demo, it doesn't break it.
        requestNotificationPermissionIfNeeded()

        val scroll = ScrollView(this).apply { setBackgroundColor(Theme.bg(this@DemoActivity)) }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(res(), 16), dp(res(), 20), dp(res(), 16), dp(res(), 32))
        }

        // Brand header — mark + wordmark + one-line purpose statement. Chrome text
        // stays "Hakka" (the mark carries the brand in the inspector itself; DESIGN.md).
        root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, dp(res(), 4))
            addView(AppIconView(this@DemoActivity), LinearLayout.LayoutParams(dp(res(), 40), dp(res(), 40)).apply {
                marginEnd = dp(res(), 12)
            })
            addView(LinearLayout(this@DemoActivity).apply {
                orientation = LinearLayout.VERTICAL
                addView(TextView(this@DemoActivity).apply {
                    text = "Hakka"; textSize = 22f; setTypeface(null, Typeface.BOLD)
                    setTextColor(Theme.text(this@DemoActivity))
                })
                addView(TextView(this@DemoActivity).apply {
                    text = "Demo & traffic generator"; textSize = 12f
                    setTextColor(Theme.textSecondary(this@DemoActivity))
                })
            })
        })

        countText = TextView(this).apply {
            text = "0 requests captured"; textSize = 13f
            setTextColor(Theme.textSecondary(this@DemoActivity))
            setPadding(0, 0, 0, dp(res(), 16))
        }
        root.addView(countText)

        permissionNoteText = noteCard(
            "Notification permission was declined. The auto-launcher notification and its " +
                "live request inbox won't appear. Fullscreen, Sheet, floating Bubble, and " +
                "shake-to-open all still work.",
            Theme.warning,
        ).apply { visibility = View.GONE }
        root.addView(permissionNoteText)

        // Entry points — every way a host app can present the inspector, all wired.
        root.addView(sectionHeader("Inspector"))
        root.addView(primaryButton("Open Fullscreen") { Hakka.open(this) })
        root.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(WRAP, dp(res(), 8)) })
        root.addView(secondaryButton("Open as Sheet") { HakkaUI.getInstance(this).showSheet(this) })
        root.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(WRAP, dp(res(), 8)) })
        root.addView(secondaryButton("Show Floating Bubble") { HakkaUI.getInstance(this).show(this) })

        // HTTP Methods — reuses the exact method-chip grammar the request list uses.
        root.addView(sectionHeader("HTTP Methods"))
        root.addView(buttonRow(
            methodButton("GET") { makeRequest("GET", "https://httpbin.org/get") },
            methodButton("POST") { makeRequest("POST", "https://httpbin.org/post") },
            methodButton("PUT") { makeRequest("PUT", "https://httpbin.org/put") },
            methodButton("DELETE") { makeRequest("DELETE", "https://httpbin.org/delete") },
        ))

        root.addView(sectionHeader("Response Sizes"))
        root.addView(buttonRow(
            demoChip("Small", Theme.success) { makeRequest("GET", "https://jsonplaceholder.typicode.com/posts/1") },
            demoChip("Medium", Theme.success) { makeRequest("GET", "https://dummyjson.com/users?limit=30") },
            demoChip("Large", Theme.success) { makeRequest("GET", "https://dummyjson.com/products?limit=100") },
        ))

        root.addView(sectionHeader("Status Codes"))
        root.addView(buttonRow(
            demoChip("200", Theme.success) { makeRequest("GET", "https://httpstat.us/200") },
            demoChip("404", Theme.error) { makeRequest("GET", "https://httpstat.us/404") },
            demoChip("500", Theme.error) { makeRequest("GET", "https://httpstat.us/500") },
            demoChip("429", Theme.error) { makeRequest("GET", "https://httpstat.us/429") },
        ))

        root.addView(sectionHeader("Redirects"))
        root.addView(buttonRow(
            demoChip("1 hop", Theme.warning) { makeRequest("GET", "https://httpbin.org/redirect/1") },
            demoChip("3 hops", Theme.warning) { makeRequest("GET", "https://httpbin.org/redirect/3") },
            demoChip("6 hops", Theme.warning) { makeRequest("GET", "https://httpbin.org/redirect/6") },
        ))

        root.addView(sectionHeader("Timing"))
        root.addView(buttonRow(
            demoChip("Fast", Theme.success) { makeRequest("GET", "https://httpbin.org/get") },
            demoChip("1s", Theme.success) { makeRequest("GET", "https://httpbin.org/delay/1") },
            demoChip("3s", Theme.success) { makeRequest("GET", "https://httpbin.org/delay/3") },
        ))

        root.addView(sectionHeader("Content Types"))
        root.addView(buttonRow(
            demoChip("JSON", Theme.info) { makeRequest("GET", "https://httpbin.org/json") },
            demoChip("XML", Theme.info) { makeRequest("GET", "https://httpbin.org/xml") },
            demoChip("Image", Theme.info) { makeRequest("GET", "https://httpbin.org/image/png") },
        ))

        root.addView(sectionHeader("Failures"))
        root.addView(buttonRow(
            demoChip("DNS Fail", Theme.error) { makeRequest("GET", "https://nonexistent.invalid/api") },
            demoChip("SSL Err", Theme.error) { makeRequest("GET", "https://expired.badssl.com/") },
            demoChip("403", Theme.error) { makeRequest("GET", "https://httpstat.us/403") },
        ))

        root.addView(sectionHeader("Auth Headers"))
        root.addView(buttonRow(demoChip("Bearer Token", Theme.accent(this)) { makeAuthRequest() }))

        root.addView(sectionHeader("Batch Tests"))
        root.addView(buttonRow(
            demoChip("Rapid 10", Theme.warning) { rapidFire(10) },
            demoChip("Rapid 30", Theme.warning) { rapidFire(30) },
            demoChip("All Types", Theme.warning) { allTypes() },
        ))

        // Mock Engine: every rule shape MockEngine ships. A full response, an aborted
        // request (block), a rewritten destination (redirectTo), an in-flight edit on a
        // real round-trip (modify), a simulated transport failure, and skipCount/stopAfter
        // gating (see rapidFireLimited()).
        root.addView(sectionHeader("Mock Engine"))
        root.addView(buttonRow(
            demoChip("Add All Rules", Theme.success) { addMockRules() },
            demoChip("Clear All", Theme.textSecondary(this)) { MockEngine.shared.clearRules() },
        ))
        root.addView(buttonRow(
            demoChip("Response", Theme.info) { makeRequest("GET", "https://api.example.com/mocked") },
            demoChip("Block", Theme.error) { makeRequest("GET", "https://api.example.com/blocked") },
            demoChip("Redirect", Theme.warning) { makeRequest("GET", "https://api.example.com/redirect-me") },
        ))
        root.addView(buttonRow(
            demoChip("Modify", Theme.info) { makeRequest("GET", "https://httpbin.org/uuid") },
            demoChip("Failure", Theme.error) { makeRequest("GET", "https://api.example.com/fails") },
            demoChip("Skip+Stop x5", Theme.warning) { rapidFireLimited() },
        ))

        // Breakpoints: pauses the matched request on-device until a human resumes or
        // aborts it from Rules > Breakpoints. "Trigger" hits a pattern nothing else in
        // this demo uses, so adding the rule can't accidentally stall another section.
        root.addView(sectionHeader("Breakpoints"))
        root.addView(buttonRow(
            demoChip("Add Rule", Theme.success) { addBreakpointRule() },
            demoChip("Trigger", Theme.warning) { makeRequest("GET", "https://httpbin.org/anything") },
            demoChip("Clear", Theme.textSecondary(this)) { BreakpointEngine.shared.clearBreakpoints() },
        ))
        root.addView(noteCard(
            "Trigger pauses on-device until you resume or abort it from Rules > " +
                "Breakpoints > Paused.",
            Theme.info,
        ))

        // Throttle: a global bandwidth/latency simulation, not scoped to one pattern or
        // request. Setting a profile affects every call in this demo until reset to None.
        root.addView(sectionHeader("Throttle"))
        root.addView(buttonRow(
            demoChip("None", Theme.textSecondary(this)) { ThrottleEngine.shared.setProfile(ThrottleProfile.NONE) },
            demoChip("Fast 3G", Theme.info) { ThrottleEngine.shared.setProfile(ThrottleProfile.FAST_3G) },
            demoChip("Slow 3G", Theme.warning) { ThrottleEngine.shared.setProfile(ThrottleProfile.SLOW_3G) },
        ))
        root.addView(buttonRow(
            demoChip("Edge", Theme.warning) { ThrottleEngine.shared.setProfile(ThrottleProfile.EDGE) },
            demoChip("Offline", Theme.error) { ThrottleEngine.shared.setProfile(ThrottleProfile.OFFLINE) },
            demoChip("Send Request", Theme.success) { makeRequest("GET", "https://httpbin.org/get") },
        ))

        // Structured Logs: Hakka.log*, the Logs tab's Structured mode. Independent of
        // network capture, these never touch the OkHttp client.
        root.addView(sectionHeader("Structured Logs"))
        root.addView(buttonRow(
            demoChip("Debug", Theme.textSecondary(this)) {
                Hakka.logDebug(this, "Demo debug log", category = "demo")
            },
            demoChip("Info", Theme.info) {
                Hakka.logInfo(this, "Demo info log", category = "demo", metadata = mapOf("screen" to "DemoActivity"))
            },
            demoChip("Warn", Theme.warning) {
                Hakka.logWarn(this, "Demo warning log", category = "demo")
            },
        ))
        root.addView(buttonRow(
            demoChip("Error", Theme.error) {
                Hakka.logError(this, "Demo error log", category = "demo", metadata = mapOf("code" to "500"))
            },
        ))

        // Storage: the Storage tab reads SharedPreferences directly off disk, so any
        // write here shows up without extra wiring. The "token" key exercises the same
        // sensitiveBodyFields redaction configured on installHakka() above (an exact,
        // case-insensitive key match, not a substring one, so the key has to be "token").
        root.addView(sectionHeader("Storage"))
        root.addView(buttonRow(
            demoChip("Write Demo Prefs", Theme.success) { writeDemoPrefs() },
            demoChip("Clear Demo Prefs", Theme.textSecondary(this)) { clearDemoPrefs() },
        ))

        // WebSocket: HakkaWebSocketWrapper.prepare() against a public echo server. Open
        // first, then Send Frame and Close act on the connection Open created.
        root.addView(sectionHeader("WebSocket"))
        root.addView(buttonRow(
            demoChip("Open", Theme.success) { openWebSocket() },
            demoChip("Send Frame", Theme.info) { sendWebSocketFrame() },
            demoChip("Close", Theme.textSecondary(this)) { closeWebSocket() },
        ))

        // GraphQL: the GraphQL detail tab keys off the URL containing "graphql" (or a
        // graphql content-type), so a plain POST to a public GraphQL endpoint is enough.
        root.addView(sectionHeader("GraphQL"))
        root.addView(buttonRow(demoChip("Send Query", Theme.info) { makeGraphQLRequest() }))

        // Exports and the desktop bridge are already reachable from the inspector itself
        // (share icon; Settings gearshape icon) regardless of what this demo does. These
        // are pointers, not new controls.
        root.addView(sectionHeader("Exports"))
        root.addView(noteCard(
            "Every captured request exports as HAR, cURL, a Postman collection, or OTel " +
                "JSON. Open the inspector, select requests in Network, then use the share icon.",
            Theme.info,
        ))

        root.addView(sectionHeader("Desktop Bridge"))
        root.addView(noteCard(
            "Connect to the Hakka desktop app or hakka mcp from Settings inside the " +
                "inspector (gearshape icon, top right of every tab). It auto-discovers a " +
                "bridge on the local network, or accepts a manual ws:// URL.",
            Theme.info,
        ))

        scroll.addView(root)
        setContentView(scroll)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_NOTIFICATIONS) return
        notificationsDenied = grantResults.isEmpty() || grantResults[0] != PackageManager.PERMISSION_GRANTED
        if (::permissionNoteText.isInitialized) {
            permissionNoteText.visibility = if (notificationsDenied) View.VISIBLE else View.GONE
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun res() = resources

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
    }

    private fun sectionHeader(title: String) = TextView(this).apply {
        text = title; textSize = 11f
        setTextColor(Theme.textSecondary(this@DemoActivity))
        setTypeface(null, Typeface.BOLD)
        isAllCaps = true; letterSpacing = 0.04f
        setPadding(0, dp(res(), 20), 0, dp(res(), 8))
    }

    /** Filled accent button — the one primary, most-frequent entry point. */
    private fun primaryButton(label: String, onClick: () -> Unit) = TextView(this).apply {
        text = label; textSize = 15f
        setTextColor(Theme.badgeText); setTypeface(null, Typeface.BOLD)
        gravity = Gravity.CENTER
        setPadding(dp(res(), 16), dp(res(), 14), dp(res(), 16), dp(res(), 14))
        background = GradientDrawable().apply {
            cornerRadius = dp(res(), Theme.radiusM).toFloat()
            setColor(Theme.accent(this@DemoActivity))
        }
        isClickable = true; isFocusable = true
        addRipple(this@DemoActivity)
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(MATCH, WRAP)
    }

    /** Outlined accent button — secondary entry points, same radius-md rule. */
    private fun secondaryButton(label: String, onClick: () -> Unit) = TextView(this).apply {
        text = label; textSize = 14f
        setTextColor(Theme.accent(this@DemoActivity)); setTypeface(null, Typeface.BOLD)
        gravity = Gravity.CENTER
        setPadding(dp(res(), 16), dp(res(), 12), dp(res(), 16), dp(res(), 12))
        background = GradientDrawable().apply {
            cornerRadius = dp(res(), Theme.radiusM).toFloat()
            setColor(Color.TRANSPARENT)
            setStroke(dp(res(), 1), Theme.accent(this@DemoActivity))
        }
        isClickable = true; isFocusable = true
        addRipple(this@DemoActivity)
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(MATCH, WRAP)
    }

    /** Method chip, wired for tap — same outlined mono-tint grammar the request list uses. */
    private fun methodButton(method: String, onClick: () -> Unit): TextView =
        methodChip(this, method, widthDp = 66, sp = 12f).apply {
            setPadding(dp(res(), 8), dp(res(), 10), dp(res(), 8), dp(res(), 10))
            isClickable = true; isFocusable = true
            addRipple(this@DemoActivity)
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(0, WRAP, 1f).apply {
                setMargins(dp(res(), 4), 0, dp(res(), 4), 0)
            }
        }

    /**
     * Wok Hei outlined action chip — ~10% tone tint background, ~40% tone border, tone text.
     * Same box language as the request list's quiet quick-chips, applied to prose labels
     * instead of data (this is a traffic *generator*, not a filter), so text isn't mono/allcaps.
     * Always pass through [buttonRow]: the weighted 0dp width only resolves against a
     * horizontal parent, a bare vertical placement collapses to zero width.
     */
    private fun demoChip(label: String, tone: Int, onClick: () -> Unit): TextView {
        val bg = GradientDrawable().apply {
            cornerRadius = dp(res(), Theme.radiusM).toFloat()
            setColor(Color.argb(26, Color.red(tone), Color.green(tone), Color.blue(tone)))
            setStroke(dp(res(), 1), Color.argb(102, Color.red(tone), Color.green(tone), Color.blue(tone)))
        }
        return TextView(this).apply {
            text = label; textSize = 12f; gravity = Gravity.CENTER
            setTextColor(tone); setTypeface(null, Typeface.BOLD)
            background = bg
            setPadding(dp(res(), 8), dp(res(), 10), dp(res(), 8), dp(res(), 10))
            isClickable = true; isFocusable = true
            addRipple(this@DemoActivity)
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(0, WRAP, 1f).apply {
                setMargins(dp(res(), 4), 0, dp(res(), 4), 0)
            }
        }
    }

    /** Full-width tinted note. Same tone language as [demoChip], for prose instead of a tap target. */
    private fun noteCard(text: String, tone: Int): TextView {
        val bg = GradientDrawable().apply {
            cornerRadius = dp(res(), Theme.radiusM).toFloat()
            setColor(Color.argb(20, Color.red(tone), Color.green(tone), Color.blue(tone)))
            setStroke(dp(res(), 1), Color.argb(80, Color.red(tone), Color.green(tone), Color.blue(tone)))
        }
        return TextView(this).apply {
            this.text = text; textSize = 12f
            setTextColor(Theme.textSecondary(this@DemoActivity))
            setLineSpacing(dp(res(), 2).toFloat(), 1f)
            background = bg
            setPadding(dp(res(), 12), dp(res(), 10), dp(res(), 12), dp(res(), 10))
            layoutParams = LinearLayout.LayoutParams(MATCH, WRAP).apply {
                setMargins(0, 0, 0, dp(res(), 8))
            }
        }
    }

    private fun buttonRow(vararg buttons: TextView) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        for (btn in buttons) addView(btn)
        setPadding(0, 0, 0, dp(res(), 4))
    }

    // ── Network requests ─────────────────────────────────────────────────

    private fun enqueue(request: Request) {
        client.newCall(request).enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                response.close()
                runOnUiThread { countText.text = "${++requestCount} requests captured" }
            }
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread { countText.text = "${++requestCount} requests captured" }
            }
        })
    }

    private fun makeRequest(method: String, url: String) {
        val builder = Request.Builder().url(url)
        when (method) {
            "POST" -> builder.post("{\"name\":\"Test\"}".toRequestBody("application/json".toMediaType()))
            "PUT" -> builder.put("{\"name\":\"Test\"}".toRequestBody("application/json".toMediaType()))
            "DELETE" -> builder.delete()
        }
        enqueue(builder.build())
    }

    private fun makeAuthRequest() {
        enqueue(
            Request.Builder()
                .url("https://httpbin.org/bearer")
                .header("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.test-token")
                .header("Cookie", "session=abc123")
                .build(),
        )
    }

    private fun makeGraphQLRequest() {
        val query = """{"query":"{ countries(filter: {code: {eq: \"US\"}}) { name capital currency } }"}"""
        enqueue(
            Request.Builder()
                .url("https://countries.trevorblades.com/graphql")
                .post(query.toRequestBody("application/json".toMediaType()))
                .build(),
        )
    }

    private fun rapidFire(count: Int) {
        val urls = listOf(
            "https://httpbin.org/get",
            "https://jsonplaceholder.typicode.com/posts/1",
            "https://httpbin.org/json",
            "https://catfact.ninja/fact",
        )
        repeat(count) { i -> makeRequest("GET", urls[i % urls.size]) }
    }

    /**
     * Fires 5 calls at the skipCount/stopAfter mock rule added by [addMockRules]: call 1
     * passes through untouched (skipCount = 1), calls 2 through 4 are mocked
     * (stopAfter = 3), call 5 passes through again. Inspect Network to see the boundary.
     */
    private fun rapidFireLimited() {
        repeat(5) { makeRequest("GET", "https://httpbin.org/user-agent") }
    }

    private fun allTypes() {
        makeRequest("GET", "https://httpbin.org/get")
        makeRequest("POST", "https://httpbin.org/post")
        makeRequest("PUT", "https://httpbin.org/put")
        makeRequest("DELETE", "https://httpbin.org/delete")
        makeRequest("GET", "https://httpstat.us/200")
        makeRequest("GET", "https://httpstat.us/404")
        makeRequest("GET", "https://httpstat.us/500")
        makeRequest("GET", "https://httpbin.org/redirect/3")
        makeRequest("GET", "https://httpbin.org/delay/1")
        makeRequest("GET", "https://httpbin.org/json")
        makeRequest("GET", "https://httpbin.org/xml")
        makeRequest("GET", "https://httpbin.org/image/png")
    }

    // ── Mock Engine ──────────────────────────────────────────────────────

    private fun addMockRules() {
        val engine = MockEngine.shared

        // Full mock: a fabricated response, no network call is ever made.
        engine.addRule(MockRuleInput(
            pattern = "api.example.com/mocked",
            response = MockResponse(
                status = 200,
                headers = mapOf("Content-Type" to "application/json"),
                body = "{\"message\": \"This is a mocked response from Hakka!\", \"mocked\": true}",
                delayMs = 500,
            ),
        ))

        // Block: aborts before the request ever leaves the device.
        engine.addRule(MockRuleInput(
            pattern = "api.example.com/blocked",
            block = true,
            response = MockResponse(),
        ))

        // Redirect: the real network call goes to redirectTo, not the matched URL.
        engine.addRule(MockRuleInput(
            pattern = "api.example.com/redirect-me",
            redirectTo = "https://httpbin.org/get",
            response = MockResponse(),
        ))

        // Modify: a real round trip to httpbin, edited in flight. One response header
        // added, one body find/replace applied.
        engine.addRule(MockRuleInput(
            pattern = "httpbin.org/uuid",
            response = MockResponse(),
            modify = MockRuleModify(
                setResponseHeaders = mapOf("X-Hakka-Modified" to "true"),
                replaceBody = listOf(MockRuleModify.BodyReplacement(find = "uuid", replace = "hakka-uuid")),
            ),
        ))

        // Failure: a simulated transport failure, no real request is sent.
        engine.addRule(MockRuleInput(
            pattern = "api.example.com/fails",
            failure = MockFailure(MockFailureCode.CONNECTION_LOST),
            response = MockResponse(),
        ))

        // Skip the first match, mock the next three, then pass through again. See
        // rapidFireLimited().
        engine.addRule(MockRuleInput(
            pattern = "httpbin.org/user-agent",
            response = MockResponse(status = 200, body = "{\"mocked\": true}"),
            skipCount = 1,
            stopAfter = 3,
        ))
    }

    // ── Breakpoints ──────────────────────────────────────────────────────

    private fun addBreakpointRule() {
        BreakpointEngine.shared.addBreakpoint(
            BreakpointRuleInput(pattern = "httpbin.org/anything", on = BreakpointPhase.REQUEST),
        )
    }

    // ── Storage ──────────────────────────────────────────────────────────

    private fun writeDemoPrefs() {
        getSharedPreferences(DEMO_PREFS_NAME, MODE_PRIVATE).edit()
            .putString("theme", "dark")
            .putBoolean("onboarded", true)
            .putInt("session_count", ++prefsSessionCount)
            .putString("token", "demo-secret-token-123")
            .apply()
    }

    private fun clearDemoPrefs() {
        getSharedPreferences(DEMO_PREFS_NAME, MODE_PRIVATE).edit().clear().apply()
        prefsSessionCount = 0
    }

    // ── WebSocket ────────────────────────────────────────────────────────

    private fun openWebSocket() {
        val prepared = HakkaWebSocketWrapper.prepare(
            url = WS_ECHO_URL,
            delegate = null,
            logStore = interceptor.logStore,
        )
        wsCapture = prepared.webSocket
        client.newWebSocket(Request.Builder().url(WS_ECHO_URL).build(), prepared.listener)
    }

    private fun sendWebSocketFrame() {
        wsCapture?.send("Hello from the Hakka demo (${System.currentTimeMillis()})")
    }

    private fun closeWebSocket() {
        wsCapture?.close(1000, "Demo closed")
        wsCapture = null
    }

    companion object {
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
        private const val REQUEST_NOTIFICATIONS = 1001
        private const val DEMO_PREFS_NAME = "hakka_demo_prefs"
        private const val WS_ECHO_URL = "wss://ws.postman-echo.com/raw"
    }
}
