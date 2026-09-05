package com.noodleapps.hakka.ui

import com.noodleapps.hakka.MockRule

/**
 * Mock rule semantics — a rule is one of three actions, mirroring
 * `packages/hakka-browser/src/ui/MockTab.tsx`'s mock/redirect/block trio. Pure
 * data → data/String/Int, no view construction, so Compose Rules rendering shares
 * one definition of what each rule means.
 */
internal enum class RuleAction { MOCK, REDIRECT, BLOCK }

internal fun actionOf(rule: MockRule): RuleAction = when {
    rule.block -> RuleAction.BLOCK
    rule.redirectTo != null -> RuleAction.REDIRECT
    else -> RuleAction.MOCK
}

internal fun actionColor(action: RuleAction): Int = when (action) {
    RuleAction.MOCK -> Theme.success
    RuleAction.REDIRECT -> Theme.warning
    RuleAction.BLOCK -> Theme.error
}

internal fun actionLabel(action: RuleAction): String = when (action) {
    RuleAction.MOCK -> "MOCK"
    RuleAction.REDIRECT -> "REDIRECT"
    RuleAction.BLOCK -> "BLOCK"
}

internal fun detailText(rule: MockRule, action: RuleAction): String {
    val base = when (action) {
        RuleAction.MOCK -> {
            val delay = rule.response.delayMs
            if (delay > 0) "${rule.response.status} · ${delay}ms" else "${rule.response.status}"
        }
        RuleAction.REDIRECT -> "→ ${rule.redirectTo}"
        RuleAction.BLOCK -> "aborts before reaching server"
    }
    return if (rule.enabled) base else "$base · disabled"
}
