package com.noodleapps.hakka.ui

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.CheckBox
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.noodleapps.hakka.MockEngine
import com.noodleapps.hakka.MockResponse
import com.noodleapps.hakka.MockRule

/**
 * MocksPanel — native Android UI for [MockEngine], embedded as the "Mocks" section of
 * [RulesTabController]'s segmented switch (Mocks | Breakpoints | Throttle). Closes the loop
 * on [DetailActivity]'s "Mock this" overflow action: that action only ever wrote into
 * [MockEngine.shared] with no way to see, edit, toggle, or delete the rule it created — this
 * panel is that view + editor, structurally the sibling of [BreakpointsPanel] (same
 * view-construction helpers, same [AlertDialog] editor pattern, same poll + subscribe
 * refresh loop) but with a single rules section instead of paused-entries + rules.
 *
 * A rule is one of three actions, mirroring `packages/hakka-browser/src/ui/MockTab.tsx`'s
 * mock/redirect/block trio:
 * - **Mock** — respond with [MockResponse] (status/body/delayMs) without touching the network.
 * - **Redirect** — send the real request to [MockRule.redirectTo] instead.
 * - **Block** — abort the request before it is sent ([MockRule.block]).
 *
 * Call [onResume]/[onPause] from the hosting Activity's lifecycle methods.
 */
internal class MocksPanel(private val activity: Activity) {

    private val engine get() = MockEngine.shared
    private val mainHandler = Handler(Looper.getMainLooper())
    private var unsubscribe: (() -> Unit)? = null

    private lateinit var rulesRecyclerView: RecyclerView
    private lateinit var emptyState: View
    private lateinit var headerCountLabel: TextView
    private lateinit var clearAllBtn: TextView

    private var rules: List<MockRule> = emptyList()

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /** Idempotent — see [BreakpointsPanel.onResume] for why re-arming must be safe to repeat. */
    fun onResume() {
        refresh()
        unsubscribe?.invoke()
        unsubscribe = engine.subscribe {
            mainHandler.post { refresh() }
        }
        mainHandler.removeCallbacks(poller)
        mainHandler.postDelayed(poller, POLL_INTERVAL_MS)
    }

    fun onPause() {
        unsubscribe?.invoke()
        unsubscribe = null
        mainHandler.removeCallbacks(poller)
    }

    // Polls in addition to [MockEngine.subscribe] so hit counts (bumped from the OkHttp
    // thread on every match, with no listener notification for that path) stay fresh.
    private val poller: Runnable = object : Runnable {
        override fun run() {
            refresh()
            mainHandler.postDelayed(this, POLL_INTERVAL_MS)
        }
    }

    // ── View construction ─────────────────────────────────────────────────────

    fun buildView(): View {
        val scroll = ScrollView(activity).apply {
            setBackgroundColor(Theme.bg(activity))
        }
        val scrollContent = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
        }

        scrollContent.addView(buildHeader())

        val listContainer = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        emptyState = buildEmptyState(
            activity, "No mock rules yet",
            "Add a rule below, or use \"Mock this\" from a request's detail view.",
        )
        rulesRecyclerView = RecyclerView(activity).apply {
            setBackgroundColor(Theme.bg(activity))
            layoutManager = LinearLayoutManager(activity)
            adapter = RulesAdapter()
            isNestedScrollingEnabled = false
            setHasFixedSize(false)
        }
        listContainer.addView(emptyState)
        listContainer.addView(rulesRecyclerView)
        scrollContent.addView(listContainer, LinearLayout.LayoutParams(MP, WC))

        scroll.addView(scrollContent)
        refresh()
        return scroll
    }

    private fun buildHeader() = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Theme.surface(activity))
        setPadding(dp(Theme.s12), dp(Theme.s8), dp(Theme.s8), dp(Theme.s8))

        addView(LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
            addView(boldText(activity, "Mock Rules", 14f))
            headerCountLabel = grayText(activity, "", 11f)
            addView(headerCountLabel)
        })

        clearAllBtn = TextView(activity).apply {
            text = "Clear All"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.error)
            setPadding(dp(Theme.s8), dp(Theme.s6), dp(Theme.s8), dp(Theme.s6))
            minHeight = dp(48)
            gravity = Gravity.CENTER_VERTICAL
            isClickable = true; isFocusable = true
            addRipple(activity)
            setOnClickListener {
                AlertDialog.Builder(activity)
                    .setTitle("Remove all mock rules?")
                    .setPositiveButton("Remove") { _, _ -> engine.clearRules() }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }
        addView(clearAllBtn)

        addView(TextView(activity).apply {
            text = "+ Rule"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.accent(activity))
            setPadding(dp(Theme.s8), dp(Theme.s6), dp(Theme.s8), dp(Theme.s6))
            minHeight = dp(48)
            gravity = Gravity.CENTER_VERTICAL
            isClickable = true; isFocusable = true
            addRipple(activity)
            setOnClickListener { showRuleDialog(activity, engine, existing = null) }
        })
    }

    // ── Refresh ───────────────────────────────────────────────────────────────

    private fun refresh() {
        rules = engine.getRules()

        headerCountLabel.text = "${rules.size} rule${if (rules.size != 1) "s" else ""}"
        clearAllBtn.visibility = if (rules.isEmpty()) View.GONE else View.VISIBLE

        val hasRules = rules.isNotEmpty()
        emptyState.visibility = if (hasRules) View.GONE else View.VISIBLE
        rulesRecyclerView.visibility = if (hasRules) View.VISIBLE else View.GONE

        rulesRecyclerView.adapter?.notifyDataSetChanged()
    }

    // ── Rules adapter ─────────────────────────────────────────────────────────
    // Action semantics (RuleAction, actionOf/actionColor/actionLabel/detailText)
    // live in MocksRuleSemantics.kt — shared with the add/edit dialog below.

    private inner class RulesAdapter : RecyclerView.Adapter<RuleViewHolder>() {
        override fun getItemCount() = rules.size

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
            RuleViewHolder(buildRuleRowLayout())

        override fun onBindViewHolder(holder: RuleViewHolder, pos: Int) {
            bindRuleRow(holder, rules[pos])
        }
    }

    /** Stable child-view references for one rule row — bound in place, never rebuilt. */
    private inner class RuleViewHolder(row: LinearLayout) : RecyclerView.ViewHolder(row) {
        val enabledCheck: CheckBox = row.findViewWithTag("enabledCheck")
        val methodChipHolder: LinearLayout = row.findViewWithTag("methodChipHolder")
        val patternLabel: TextView = row.findViewWithTag("patternLabel")
        val actionBadge: TextView = row.findViewWithTag("actionBadge")
        val detailLabel: TextView = row.findViewWithTag("detailLabel")
        val hitCountLabel: TextView = row.findViewWithTag("hitCountLabel")
        val editBtn: TextView = row.findViewWithTag("editBtn")
        val deleteBtn: ImageView = row.findViewWithTag("deleteBtn")
    }

    private fun buildRuleRowLayout(): LinearLayout = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = ViewGroup.LayoutParams(MP, WC)

        addView(LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(Theme.s8), dp(Theme.s8), dp(Theme.s8), dp(Theme.s8))

            addView(CheckBox(activity).apply { tag = "enabledCheck" })

            // Holder for a freshly-built methodChip() view — swapped whole on bind rather
            // than mutated, since methodChip() only knows how to construct, not restyle.
            addView(LinearLayout(activity).apply {
                tag = "methodChipHolder"
                layoutParams = LinearLayout.LayoutParams(WC, WC).apply {
                    setMargins(dp(Theme.s4), 0, dp(Theme.s8), 0)
                }
            })

            addView(LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
                addView(TextView(activity).apply { tag = "patternLabel"; textSize = GeneratedMetrics.FontSize.md.toFloat() })
                addView(LinearLayout(activity).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                    setPadding(0, dp(GeneratedMetrics.Spacing.xxs), 0, 0)
                    addView(TextView(activity).apply {
                        tag = "actionBadge"; textSize = GeneratedMetrics.FontSize.xxs.toFloat(); setTypeface(null, Typeface.BOLD)
                        setTextColor(Theme.badgeText)
                        setPadding(dp(Theme.s4), dp(1), dp(Theme.s4), dp(1))
                        layoutParams = LinearLayout.LayoutParams(WC, WC).apply {
                            setMargins(0, 0, dp(Theme.s6), 0)
                        }
                    })
                    addView(TextView(activity).apply {
                        tag = "detailLabel"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setSingleLine()
                        ellipsize = android.text.TextUtils.TruncateAt.END
                        layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
                    })
                    addView(TextView(activity).apply {
                        tag = "hitCountLabel"; textSize = GeneratedMetrics.FontSize.xs.toFloat(); setTypeface(Typeface.MONOSPACE)
                        setPadding(dp(Theme.s6), 0, 0, 0)
                    })
                })
            })

            addView(TextView(activity).apply {
                tag = "editBtn"; text = "Edit"; textSize = GeneratedMetrics.FontSize.sm.toFloat()
                setPadding(dp(Theme.s8), 0, dp(Theme.s8), 0)
                minHeight = dp(48)
                minWidth = dp(48)
                gravity = Gravity.CENTER
                isClickable = true; isFocusable = true
                addRipple(activity)
            })

            addView(ImageView(activity).apply {
                tag = "deleteBtn"
                setImageResource(R.drawable.hakka_ic_close)
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                setPadding(dp(Theme.s14), dp(Theme.s14), dp(Theme.s14), dp(Theme.s14))
                layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
                isClickable = true; isFocusable = true
                addRipple(activity)
            })
        })

        addView(divider(activity).apply {
            layoutParams = LinearLayout.LayoutParams(MP, dp(1)).apply {
                setMargins(dp(Theme.s12), 0, dp(Theme.s12), 0)
            }
        })
    }

    private fun bindRuleRow(holder: RuleViewHolder, rule: MockRule) {
        val action = actionOf(rule)

        holder.enabledCheck.apply {
            isChecked = rule.enabled
            setOnClickListener {
                if (isChecked) engine.enableRule(rule.id) else engine.disableRule(rule.id)
            }
        }

        // Method chips are the correct affordance here (not plain text) — unlike the
        // read-only Network request list, every row in this screen is itself an
        // interactive control (toggle / edit / delete), matching DESIGN.md's
        // "controls use chips" rule rather than "list rows use plain text".
        holder.methodChipHolder.removeAllViews()
        holder.methodChipHolder.addView(methodChip(activity, rule.method ?: "ANY"))

        holder.patternLabel.apply {
            text = rule.pattern.ifEmpty { "(any)" }
            setTextColor(Theme.text(activity))
            setTypeface(Typeface.MONOSPACE)
        }

        holder.actionBadge.apply {
            text = actionLabel(action)
            val color = actionColor(action)
            background = GradientDrawable().apply {
                cornerRadius = dp(Theme.radiusS).toFloat()
                setColor(color)
            }
        }

        holder.detailLabel.apply {
            text = detailText(rule, action)
            setTextColor(if (rule.enabled) Theme.textSecondary(activity) else Theme.textTertiary(activity))
            setTypeface(Typeface.MONOSPACE)
        }

        holder.hitCountLabel.apply {
            text = "${rule.hitCount} hit${if (rule.hitCount != 1) "s" else ""}"
            setTextColor(Theme.textTertiary(activity))
        }

        holder.editBtn.apply {
            setTextColor(Theme.accent(activity))
            setOnClickListener { showRuleDialog(activity, engine, existing = rule) }
        }

        holder.deleteBtn.apply {
            setColorFilter(Theme.error)
            setOnClickListener {
                AlertDialog.Builder(activity)
                    .setTitle("Remove mock rule?")
                    .setMessage("Pattern: '${rule.pattern.ifEmpty { "(any)" }}'")
                    .setPositiveButton("Remove") { _, _ -> engine.removeRule(rule.id) }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }
    }

    // ── Add / Edit rule dialog ──────────────────────────────────────────────────
    // showRuleDialog(activity, engine, existing) lives in MocksRuleDialog.kt.

    // ── Helpers ────────────────────────────────────────────────────────────────

    private fun dp(dp: Int): Int = dp(activity.resources, dp)

    companion object {
        private const val POLL_INTERVAL_MS = 500L
    }
}
