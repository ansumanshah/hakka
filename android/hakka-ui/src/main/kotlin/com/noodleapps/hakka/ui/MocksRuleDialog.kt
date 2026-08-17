package com.noodleapps.hakka.ui

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Typeface
import android.text.InputType
import android.view.View
import android.widget.CheckBox
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Toast
import com.noodleapps.hakka.MockEngine
import com.noodleapps.hakka.MockResponse
import com.noodleapps.hakka.MockRule
import com.noodleapps.hakka.MockRuleInput

/** [MocksPanel]'s add/edit rule dialog — split out purely for file size. */
private val METHOD_OPTIONS = listOf("ANY", "GET", "POST", "PUT", "PATCH", "DELETE")

internal fun showRuleDialog(activity: Activity, engine: MockEngine, existing: MockRule?) {
    val existingAction = existing?.let { actionOf(it) } ?: RuleAction.MOCK

    val layout = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(activity.resources, Theme.s16), dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s16), dp(activity.resources, Theme.s8))
    }

    val patternField = EditText(activity).apply {
        hint = "URL substring (e.g. /api/users)"
        setText(existing?.pattern ?: "")
        textSize = GeneratedMetrics.FontSize.md.toFloat(); setTypeface(Typeface.MONOSPACE)
        setTextColor(Theme.text(activity))
    }

    // Method picker — quiet chip strip, single-select. This is the genuinely
    // interactive control the chip idiom is for (as opposed to the read-only
    // method chip painted onto each list row above).
    var selectedMethod = existing?.method ?: "ANY"
    val methodStrip = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
    fun rebuildMethodStrip() {
        methodStrip.removeAllViews()
        for (m in METHOD_OPTIONS) {
            val tone = if (m == "ANY") Theme.textSecondary(activity) else methodColor(m)
            methodStrip.addView(quietQuickChip(activity, m, tone, m == selectedMethod) {
                selectedMethod = m
                rebuildMethodStrip()
            })
        }
    }
    rebuildMethodStrip()

    // Action picker — Mock / Redirect / Block, reusing the shared segmented-switch
    // component ([RulesTabController] uses the same one one level up).
    var selectedAction = existingAction
    val actionRow = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
    fun actionIndex(a: RuleAction) = when (a) { RuleAction.MOCK -> 0; RuleAction.REDIRECT -> 1; RuleAction.BLOCK -> 2 }

    // ── Conditional field groups, one per action ──
    val statusField = EditText(activity).apply {
        hint = "Status code"; setText((existing?.response?.status ?: 200).toString())
        textSize = GeneratedMetrics.FontSize.md.toFloat(); inputType = InputType.TYPE_CLASS_NUMBER
        setTextColor(Theme.text(activity))
    }
    val delayField = EditText(activity).apply {
        hint = "Delay (ms, optional)"; setText((existing?.response?.delayMs ?: 0L).toString())
        textSize = GeneratedMetrics.FontSize.md.toFloat(); inputType = InputType.TYPE_CLASS_NUMBER
        setTextColor(Theme.text(activity))
    }
    val bodyField = EditText(activity).apply {
        hint = "Response body (optional)"
        setText(if (existingAction == RuleAction.MOCK) existing?.response?.body ?: "" else "")
        textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
        minLines = 4; inputType = InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_CLASS_TEXT
        setTextColor(Theme.text(activity))
    }
    val mockFields = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        addView(grayText(activity, "Status", 11f).apply { setPadding(0, dp(activity.resources, Theme.s8), 0, 0) })
        addView(statusField)
        addView(grayText(activity, "Delay", 11f).apply { setPadding(0, dp(activity.resources, Theme.s8), 0, 0) })
        addView(delayField)
        addView(grayText(activity, "Body", 11f).apply { setPadding(0, dp(activity.resources, Theme.s8), 0, 0) })
        addView(bodyField)
    }

    val targetUrlField = EditText(activity).apply {
        hint = "https://staging.example.com/api/users"
        setText(existing?.redirectTo ?: "")
        textSize = GeneratedMetrics.FontSize.md.toFloat(); setTypeface(Typeface.MONOSPACE)
        setTextColor(Theme.text(activity))
    }
    val redirectFields = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        addView(grayText(activity, "Target URL", 11f).apply { setPadding(0, dp(activity.resources, Theme.s8), 0, 0) })
        addView(targetUrlField)
    }

    val blockHint = grayText(
        activity,
        "Matching requests are aborted with a network error before reaching the server.",
        11f,
    ).apply { setPadding(0, dp(activity.resources, Theme.s8), 0, 0) }

    fun updateActionFields() {
        mockFields.visibility = if (selectedAction == RuleAction.MOCK) View.VISIBLE else View.GONE
        redirectFields.visibility = if (selectedAction == RuleAction.REDIRECT) View.VISIBLE else View.GONE
        blockHint.visibility = if (selectedAction == RuleAction.BLOCK) View.VISIBLE else View.GONE
    }

    actionRow.addView(buildSegmentedSwitch(
        activity, listOf("Mock", "Redirect", "Block"), actionIndex(selectedAction),
    ) { index ->
        selectedAction = when (index) { 0 -> RuleAction.MOCK; 1 -> RuleAction.REDIRECT; else -> RuleAction.BLOCK }
        updateActionFields()
    })
    updateActionFields()

    val enabledCheck = CheckBox(activity).apply {
        text = "Enabled"
        isChecked = existing?.enabled ?: true
        setTextColor(Theme.text(activity))
    }

    layout.addView(grayText(activity, "URL Pattern", 11f))
    layout.addView(patternField)
    layout.addView(grayText(activity, "HTTP Method", 11f).apply { setPadding(0, dp(activity.resources, Theme.s8), 0, dp(activity.resources, Theme.s4)) })
    layout.addView(HorizontalScrollView(activity).apply {
        isHorizontalScrollBarEnabled = false
        addView(methodStrip)
    })
    layout.addView(grayText(activity, "Action", 11f).apply { setPadding(0, dp(activity.resources, Theme.s8), 0, dp(activity.resources, Theme.s4)) })
    layout.addView(actionRow)
    layout.addView(mockFields)
    layout.addView(redirectFields)
    layout.addView(blockHint)
    layout.addView(enabledCheck.apply { setPadding(0, dp(activity.resources, Theme.s8), 0, 0) })

    val title = if (existing == null) "Add Mock Rule" else "Edit Mock Rule"
    AlertDialog.Builder(activity)
        .setTitle(title)
        .setView(ScrollView(activity).apply { addView(layout) })
        .setPositiveButton(if (existing == null) "Add" else "Save") { _, _ ->
            val pattern = patternField.text.toString()
            val method = selectedMethod.takeIf { it != "ANY" }
            val enabled = enabledCheck.isChecked

            val input = when (selectedAction) {
                RuleAction.MOCK -> MockRuleInput(
                    pattern = pattern,
                    method = method,
                    response = MockResponse(
                        status = statusField.text.toString().trim().toIntOrNull() ?: 200,
                        body = bodyField.text.toString().ifEmpty { null },
                        delayMs = delayField.text.toString().trim().toLongOrNull() ?: 0L,
                    ),
                    enabled = enabled,
                    id = existing?.id,
                )
                RuleAction.REDIRECT -> MockRuleInput(
                    pattern = pattern,
                    method = method,
                    response = MockResponse(status = 200),
                    redirectTo = targetUrlField.text.toString().trim(),
                    enabled = enabled,
                    id = existing?.id,
                )
                RuleAction.BLOCK -> MockRuleInput(
                    pattern = pattern,
                    method = method,
                    response = MockResponse(status = 0),
                    block = true,
                    enabled = enabled,
                    id = existing?.id,
                )
            }

            // MockEngine.addRule replaces in place when `id` matches an existing
            // rule, so edit and add share this one call — no separate remove step.
            engine.addRule(input)
            Toast.makeText(
                activity,
                if (existing == null) "Mock rule added" else "Mock rule updated",
                Toast.LENGTH_SHORT,
            ).show()
        }
        .setNegativeButton("Cancel", null)
        .apply {
            if (existing != null) {
                setNeutralButton("Delete") { _, _ ->
                    engine.removeRule(existing.id)
                    Toast.makeText(activity, "Mock rule removed", Toast.LENGTH_SHORT).show()
                }
            }
        }
        .show()
}
