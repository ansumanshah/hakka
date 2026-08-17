package com.noodleapps.hakka.android

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.noodleapps.hakka.MockEngine
import com.noodleapps.hakka.MockResponse
import com.noodleapps.hakka.MockRuleInput
import com.noodleapps.hakka.ui.Hakka
import com.noodleapps.hakka.ui.HakkaUI
import com.noodleapps.hakka.ui.Theme
import com.noodleapps.hakka.ui.addRipple
import com.noodleapps.hakka.ui.brand.AppIconView
import com.noodleapps.hakka.ui.dp
import com.noodleapps.hakka.ui.installHakka
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
 */
class DemoActivity : Activity() {

    private lateinit var client: OkHttpClient
    private var requestCount = 0
    private lateinit var countText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // One line wires capture + the auto-launcher notification + shake-to-open.
        // perfMonitoring = true also starts native FPS/jank/memory/CPU monitoring,
        // rendered live in the inspector's Monitor tab.
        client = OkHttpClient.Builder()
            .installHakka(this, perfMonitoring = true)
            .build()

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
        root.addView(demoChip("Bearer Token", Theme.accent(this)) { makeAuthRequest() })

        root.addView(sectionHeader("Batch Tests"))
        root.addView(buttonRow(
            demoChip("Rapid 10", Theme.warning) { rapidFire(10) },
            demoChip("Rapid 30", Theme.warning) { rapidFire(30) },
            demoChip("All Types", Theme.warning) { allTypes() },
        ))

        root.addView(sectionHeader("Mock Engine"))
        root.addView(buttonRow(
            demoChip("Add Mock", Theme.success) { addMockRule() },
            demoChip("Test Mock", Theme.success) { makeRequest("GET", "https://api.example.com/mocked") },
            demoChip("Clear", Theme.textSecondary(this)) { MockEngine.shared.clearRules() },
        ))

        scroll.addView(root)
        setContentView(scroll)
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun res() = resources

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

    private fun buttonRow(vararg buttons: TextView) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        for (btn in buttons) addView(btn)
        setPadding(0, 0, 0, dp(res(), 4))
    }

    // ── Network requests ─────────────────────────────────────────────────

    private fun makeRequest(method: String, url: String) {
        val builder = Request.Builder().url(url)
        when (method) {
            "POST" -> builder.post("{\"name\":\"Test\"}".toRequestBody("application/json".toMediaType()))
            "PUT" -> builder.put("{\"name\":\"Test\"}".toRequestBody("application/json".toMediaType()))
            "DELETE" -> builder.delete()
        }
        client.newCall(builder.build()).enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                response.close()
                runOnUiThread { countText.text = "${++requestCount} requests captured" }
            }
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread { countText.text = "${++requestCount} requests captured" }
            }
        })
    }

    private fun makeAuthRequest() {
        val request = Request.Builder()
            .url("https://httpbin.org/bearer")
            .header("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.test-token")
            .header("Cookie", "session=abc123")
            .build()
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

    private fun rapidFire(count: Int) {
        val urls = listOf(
            "https://httpbin.org/get",
            "https://jsonplaceholder.typicode.com/posts/1",
            "https://httpbin.org/json",
            "https://catfact.ninja/fact",
        )
        repeat(count) { i -> makeRequest("GET", urls[i % urls.size]) }
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

    private fun addMockRule() {
        MockEngine.shared.addRule(MockRuleInput(
            pattern = "api.example.com/mocked",
            response = MockResponse(
                status = 200,
                headers = mapOf("Content-Type" to "application/json"),
                body = "{\"message\": \"This is a mocked response from Hakka!\", \"mocked\": true}",
                delayMs = 500,
            ),
        ))
    }

    companion object {
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
    }
}
