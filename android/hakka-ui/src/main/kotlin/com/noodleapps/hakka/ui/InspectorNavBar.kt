package com.noodleapps.hakka.ui

import android.content.Context
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout

/** Shared five-destination inspector navigation for both presentation shells. */
internal class InspectorNavBar(
    private val ctx: Context,
    private val onSelect: (NavTab) -> Unit,
    bottomInset: Int = 0,
) {
    private data class Item(val target: LinearLayout, val icon: ImageView)

    private val items = mutableMapOf<NavTab, Item>()
    val view = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        setBackgroundColor(Theme.surface(ctx))
        setPadding(0, 0, 0, bottomInset)
        for (tab in NavTab.entries) {
            val icon = ImageView(ctx).apply {
                setImageResource(tab.iconRes)
                layoutParams = LinearLayout.LayoutParams(
                    dp(ctx.resources, GeneratedMetrics.FontSize.xxl),
                    dp(ctx.resources, GeneratedMetrics.FontSize.xxl),
                )
            }
            val target = LinearLayout(ctx).apply {
                gravity = Gravity.CENTER
                minimumHeight = dp(ctx.resources, 48)
                contentDescription = tab.label
                isClickable = true
                isFocusable = true
                addRipple(ctx)
                addView(icon)
                setOnClickListener { onSelect(tab) }
            }
            items[tab] = Item(target, icon)
            addView(target, LinearLayout.LayoutParams(0, dp(ctx.resources, 48), 1f))
        }
    }

    fun select(selected: NavTab) {
        for ((tab, item) in items) {
            val active = tab == selected
            val tint = if (active) Theme.accent(ctx) else Theme.tabInactive(ctx)
            item.icon.imageTintList = android.content.res.ColorStateList.valueOf(tint)
            item.target.isSelected = active
        }
    }
}
