package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.compileSearchQuery
import com.noodleapps.hakka.parseSearchTokens

/** Sort field for the request list. */
enum class SortField { TIME, DURATION, SIZE, STATUS }

/** Group-by mode for the request list. */
enum class GroupBy { NONE, HOST, STATUS_CLASS, METHOD, ERROR }

/**
 * Network tab — captured-request list. Wok Hei tokens, RecyclerView with view-holder
 * recycling, filter chips.
 *
 * Lives as one tab inside [HakkaActivity]'s persistent 5-tab bottom bar. Close lives
 * once in [HakkaActivity]'s shared header; "Select requests" is a dedicated row-2 icon
 * button.
 *
 * Split across files for cohesion — this file holds shared state (every property
 * below), lifecycle ([buildView]/[onShow]), filtering/sorting/grouping, and the
 * RecyclerView adapter (its view-holders are `inner class`es and must stay in the
 * class body — Kotlin has no partial classes). Everything else is `internal`
 * extension functions in siblings: [buildNormalTopBar]/[buildSelectionTopBar]
 * (`NetworkTabControllerTopBar.kt`), search bar and quick chips
 * (`NetworkTabControllerSearchChips.kt`), the filter-chip disclosure and presets UI
 * (`NetworkTabControllerFilterChips.kt`), stats bar and preset persistence
 * (`NetworkTabControllerPresets.kt`), and selection mode / pause-resume /
 * share-export actions (`NetworkTabControllerActions.kt`).
 */
internal class NetworkTabController(internal val activity: Activity) : TabController {
    private lateinit var root: LinearLayout
    internal lateinit var topBarContainer: LinearLayout
    private lateinit var recyclerView: RecyclerView
    internal lateinit var filterContainer: LinearLayout
    internal lateinit var pausedBanner: TextView
    internal var allRequests: List<NetworkRequest> = emptyList()
    private var filteredRequests: List<NetworkRequest> = emptyList()
    internal var selectionMode = false
    internal val selectedIds = mutableSetOf<String>()
    internal var filtersExpanded = false
    internal var searchQuery = ""
    internal val activeMethodFilters = mutableSetOf<String>()
    internal var activeStatusGroup: String? = null // null = all
    internal var activeDomain: String? = null

    // Sort + group state
    internal var sortField: SortField = SortField.TIME
    internal var sortAscending: Boolean = false
    internal var groupBy: GroupBy = GroupBy.NONE

    // Filter preset persistence
    internal lateinit var presetStore: FilterPresetStore

    // Owned by the top bar (+TopBar.kt) but read by filtering (updateStatsBar in
    // +Presets.kt) — declared here since class properties can't live in extensions.
    internal lateinit var statsLabel: TextView

    // Reference so filter/sort/group changes can refresh the "+n" badge in place —
    // owned by +SearchChips.kt.
    internal lateinit var filtersTrigger: FrameLayout

    // Quick-chip strip reference so rebuildQuickChips can refresh without rebuilding
    // the search bar — owned by +SearchChips.kt.
    internal lateinit var quickChipStrip: LinearLayout

    // Search bar EditText reference (set in buildSearchBar) so applyPreset can sync
    // it — owned by +SearchChips.kt / +Presets.kt.
    internal var searchEditText: EditText? = null

    override fun buildView(): View {
        presetStore = FilterPresetStore(activity)
        root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Theme.bg(activity))
        }
        allRequests = (HakkaUI.getInstance(activity).logStore?.all() ?: emptyList()).reversed()
        filteredRequests = allRequests
        topBarContainer = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        root.addView(topBarContainer); buildNormalTopBar()
        root.addView(buildSearchBar())
        filterContainer = buildFilterSection()
        root.addView(filterContainer)
        // Paused banner — hidden by default, shown when capture is paused
        pausedBanner = TextView(activity).apply {
            text = "Capture paused — tap Resume to continue"
            textSize = GeneratedMetrics.FontSize.sm.toFloat()
            gravity = Gravity.CENTER
            setTextColor(Theme.warning)
            setBackgroundColor(Color.argb(26, 251, 191, 36)) // warning tint ~10%
            setPadding(dp(Theme.s16), dp(Theme.s8), dp(Theme.s16), dp(Theme.s8))
            // Pause glyph as a tinted vector icon, never emoji — see DESIGN.md.
            val pauseIcon = activity.resources.getDrawable(R.drawable.hakka_ic_pause, activity.theme).apply {
                setBounds(0, 0, dp(12), dp(12))
            }
            setCompoundDrawables(pauseIcon, null, null, null)
            compoundDrawablePadding = dp(Theme.s6)
            compoundDrawableTintList = ColorStateList.valueOf(Theme.warning)
            visibility = View.GONE
        }
        root.addView(pausedBanner)
        recyclerView = RecyclerView(activity).apply {
            setBackgroundColor(Theme.bg(activity))
            layoutManager = LinearLayoutManager(activity)
            adapter = RequestAdapter()
            setHasFixedSize(false)
        }
        root.addView(recyclerView, LinearLayout.LayoutParams(MP, 0, 1f))
        applyFilters()
        syncPausedState()
        return root
    }

    override fun onShow() {
        allRequests = (HakkaUI.getInstance(activity).logStore?.all() ?: emptyList()).reversed()
        rebuildQuickChips()
        rebuildFilterChips()
        applyFilters()
        syncPausedState()
    }

    // ── Filtering + sorting + grouping ──────────────────────────────────

    internal fun applyFilters() {
        var list = allRequests
        // Advanced DSL search — parses scope prefixes, regex, wildcards, negation, AND across tokens.
        // The status chip (activeStatusGroup) is forwarded to compileSearchQuery as a DSL string so
        // that both the text DSL and the chip filter are evaluated in one compiled predicate.
        if (searchQuery.isNotEmpty()) {
            val tokens = parseSearchTokens(searchQuery)
            val predicate = compileSearchQuery(tokens)
            list = list.filter { predicate(it) }
        }
        if (activeMethodFilters.isNotEmpty()) list = list.filter { it.method.name in activeMethodFilters }
        if (activeStatusGroup != null) {
            list = when (activeStatusGroup) {
                "1xx" -> list.filter { (it.status ?: 0) in 100..199 }
                "2xx" -> list.filter { (it.status ?: 0) in 200..299 }
                "3xx" -> list.filter { (it.status ?: 0) in 300..399 }
                "4xx" -> list.filter { (it.status ?: 0) in 400..499 }
                "5xx" -> list.filter { (it.status ?: 0) in 500..599 }
                else -> list
            }
        }
        if (activeDomain != null) list = list.filter { hostOf(it.url) == activeDomain }

        val comparator: Comparator<NetworkRequest> = when (sortField) {
            SortField.TIME -> compareBy { it.startTimeMs }
            SortField.DURATION -> compareBy { it.durationMs ?: Long.MAX_VALUE }
            SortField.SIZE -> compareBy { it.responseBodySize }
            SortField.STATUS -> compareBy { it.status ?: Int.MAX_VALUE }
        }
        list = if (sortAscending) list.sortedWith(comparator) else list.sortedWith(comparator.reversed())

        // Group in-memory — interleave group-header sentinels (null = header row)
        filteredRequests = if (groupBy == GroupBy.NONE) {
            list
        } else {
            val grouped = list.groupBy { r ->
                when (groupBy) {
                    GroupBy.HOST -> hostOf(r.url).ifEmpty { "unknown" }
                    GroupBy.STATUS_CLASS -> when {
                        r.error != null && r.status == null -> "Error"
                        r.status == null -> "Pending"
                        r.status!! in 200..299 -> "2xx Success"
                        r.status!! in 300..399 -> "3xx Redirect"
                        r.status!! in 400..499 -> "4xx Client Error"
                        r.status!! in 500..599 -> "5xx Server Error"
                        else -> "Other"
                    }
                    GroupBy.METHOD -> r.method.name
                    GroupBy.ERROR -> if (r.error != null || (r.status ?: 0) >= 400) "Errors" else "OK"
                    GroupBy.NONE -> ""
                }
            }
            // Flatten: use a special sentinel (startTimeMs = Long.MIN_VALUE) to mark headers
            buildList {
                for ((groupKey, items) in grouped.entries.sortedBy { it.key }) {
                    add(NetworkRequest(
                        id = "§group§$groupKey", url = groupKey,
                        method = items.first().method, status = null,
                        startTimeMs = Long.MIN_VALUE, durationMs = null,
                        requestHeaders = emptyMap(), responseHeaders = emptyMap(),
                        requestBodySize = 0, responseBodySize = 0,
                        requestBody = null, responseBody = null,
                        error = null, source = items.first().source,
                    ))
                    addAll(items)
                }
            }
        }

        updateStatsBar(filteredRequests.filter { !isGroupHeader(it) })
        (recyclerView.adapter as? RequestAdapter)?.notifyDataSetChanged()
        pushCurrentToRecent()
    }

    private fun isGroupHeader(r: NetworkRequest) = r.id.startsWith("§group§")
    private fun groupHeaderLabel(r: NetworkRequest) = r.url

    // ── RecyclerView adapter ─────────────────────────────────────────────
    // Two view types (header / row); child views are built once per ViewHolder and
    // only their text/colors are updated on bind — no removeAllViews()+addView()
    // churn per scroll frame, which is what made the old ListView row (which only
    // reused the outer container) expensive to bind at scale.

    private inner class RequestAdapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        override fun getItemCount() = filteredRequests.size
        override fun getItemViewType(pos: Int) = if (isGroupHeader(filteredRequests[pos])) 1 else 0

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder =
            if (viewType == 1) HeaderViewHolder(buildGroupHeaderView())
            else RowViewHolder(buildRowLayout())

        override fun onBindViewHolder(holder: RecyclerView.ViewHolder, pos: Int) {
            val r = filteredRequests[pos]
            if (holder is HeaderViewHolder) holder.bind(groupHeaderLabel(r))
            else if (holder is RowViewHolder) bindRow(holder, r)
        }
    }

    private inner class HeaderViewHolder(private val label: TextView) : RecyclerView.ViewHolder(label) {
        fun bind(text: String) { label.text = text }
    }

    /** Stable child-view references for one request row — bound in place, never rebuilt. */
    private inner class RowViewHolder(row: LinearLayout) : RecyclerView.ViewHolder(row) {
        val rowContent: LinearLayout = row.findViewWithTag("rowContent")
        val stripe: View = rowContent.findViewWithTag("stripe")
        val chip: TextView = rowContent.findViewWithTag("chip")
        val path: TextView = rowContent.findViewWithTag("path")
        val duration: TextView = rowContent.findViewWithTag("duration")
        val status: TextView = rowContent.findViewWithTag("status")
        val host: TextView = rowContent.findViewWithTag("host")
        val size: TextView = rowContent.findViewWithTag("size")
        val chevron: ImageView = rowContent.findViewWithTag("chevron")
    }

    private fun buildGroupHeaderView() = TextView(activity).apply {
        textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(null, Typeface.BOLD)
        setTextColor(Theme.textSecondary(activity))
        setBackgroundColor(Theme.surface(activity))
        setPadding(dp(Theme.s16), dp(Theme.s6), dp(Theme.s16), dp(Theme.s6))
        layoutParams = ViewGroup.LayoutParams(MP, WC)
    }

    /**
     * Row anatomy — two-line fixed 64dp row:
     *   [method] path···························durationms
     *   status  host·······························size
     * Absolute timestamp is dropped from the row — everything on screen during a live
     * session is "now"; it still lives in Detail → Overview → Started. Method is plain
     * colored mono text, not a chip — chips are for interactive controls, rows are data.
     */
    private fun buildRowLayout() = LinearLayout(activity).apply {
        tag = "requestRow"
        orientation = LinearLayout.VERTICAL
        layoutParams = ViewGroup.LayoutParams(MP, dp(64))
        addView(LinearLayout(context).apply {
            tag = "rowContent"; orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            // 63dp, not 64 — the outer row is a fixed dp(64) and stacks this content
            // above a dp(1) divider below. At 64+1 the divider laid out 1dp past the
            // outer container's clip bounds and never drew. 63+1 = 64 keeps the total
            // row height on-spec while making the hairline actually visible.
            layoutParams = LinearLayout.LayoutParams(MP, dp(63))
            setPadding(0, 0, dp(Theme.s8), 0)
            // Severity stripe — chili (5xx/error) / turmeric (4xx) / flame (selected). Empty otherwise.
            addView(View(context).apply {
                tag = "stripe"
                layoutParams = LinearLayout.LayoutParams(dp(2), MP)
            })
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(Theme.s10), 0, dp(Theme.s4), 0)
                layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                    addView(TextView(context).apply { tag = "chip" })
                    addView(TextView(context).apply {
                        tag = "path"; textSize = GeneratedMetrics.FontSize.md.toFloat(); setSingleLine()
                        ellipsize = TextUtils.TruncateAt.END
                        layoutParams = LinearLayout.LayoutParams(0, WC, 1f).apply {
                            setMargins(dp(Theme.s6), 0, dp(Theme.s6), 0)
                        }
                    })
                    addView(TextView(context).apply {
                        tag = "duration"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
                        gravity = Gravity.END
                        layoutParams = LinearLayout.LayoutParams(WC, WC).apply { minWidth = dp(44) }
                    })
                })
                // Line 2: status + host + size
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                    setPadding(0, dp(GeneratedMetrics.Spacing.xs), 0, 0)
                    addView(TextView(context).apply {
                        tag = "status"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
                    })
                    addView(TextView(context).apply {
                        tag = "host"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setSingleLine()
                        ellipsize = TextUtils.TruncateAt.END
                        layoutParams = LinearLayout.LayoutParams(0, WC, 1f).apply {
                            setMargins(dp(Theme.s6), 0, dp(Theme.s6), 0)
                        }
                    })
                    addView(TextView(context).apply {
                        tag = "size"; textSize = GeneratedMetrics.FontSize.xs.toFloat(); setTypeface(Typeface.MONOSPACE)
                        gravity = Gravity.END
                        layoutParams = LinearLayout.LayoutParams(WC, WC).apply { minWidth = dp(44) }
                    })
                })
            })
            // Chevron — vector icon, never a unicode glyph.
            addView(ImageView(context).apply {
                tag = "chevron"
                setImageResource(R.drawable.hakka_ic_chevron_right)
                layoutParams = LinearLayout.LayoutParams(dp(20), dp(20)).apply {
                    setMargins(dp(Theme.s4), 0, 0, 0)
                }
            })
        })
        addView(View(context).apply {
            setBackgroundColor(Theme.border(activity))
            layoutParams = LinearLayout.LayoutParams(MP, dp(1)).apply {
                setMargins(dp(Theme.s16), 0, dp(Theme.s16), 0)
            }
        })
    }

    private fun bindRow(holder: RowViewHolder, r: NetworkRequest) {
        val bg = Theme.bg(activity)
        val isSelected = selectionMode && r.id in selectedIds
        // error/5xx rows get the stripe PLUS a subtle error-tinted row background,
        // matching iOS/web; 4xx stays stripe-only.
        val isErrorRow = isErrorSeverityRow(r.status, r.error != null)
        val baseColor = when {
            isSelected -> accentTint(Theme.accent(activity))
            isErrorRow -> errorRowBackgroundTint(Theme.error)
            else -> bg
        }
        val ripple = RippleDrawable(
            ColorStateList.valueOf(Theme.border(activity)),
            GradientDrawable().apply { setColor(baseColor) }, null
        )
        holder.rowContent.background = ripple
        // Severity stripe — chili/turmeric/flame per Wok Hei row-stripe grammar
        val stripeColor = severityStripeColor(activity, r.status, r.error != null, isSelected)
        holder.stripe.setBackgroundColor(stripeColor ?: Color.TRANSPARENT)

        styleAsPlainMethodText(holder.chip, r.method.name)
        holder.path.text = pathText(r)
        holder.path.setTextColor(Theme.text(activity))
        holder.duration.text = fmtDurationOrPending(r.durationMs)
        holder.duration.setTextColor(durationColor(activity, r.durationMs))

        holder.status.text = fmtStatusOnly(r)
        holder.status.setTextColor(statusTextColor(r.status, r.error != null))
        holder.host.text = hostOf(r.url)
        holder.host.setTextColor(Theme.textTertiary(activity))
        val sizeLabel = fmtSize(r.responseBodySize)
        holder.size.text = sizeLabel
        holder.size.setTextColor(Theme.textTertiary(activity))
        holder.size.visibility = if (sizeLabel.isEmpty()) View.INVISIBLE else View.VISIBLE

        holder.chevron.imageTintList = ColorStateList.valueOf(Theme.textSecondary(activity))
        holder.chevron.visibility = if (selectionMode) View.GONE else View.VISIBLE

        val row = holder.itemView
        if (selectionMode) {
            row.setOnClickListener { toggleSelection(r.id); applyFilters() }
            row.setOnLongClickListener(null)
        } else {
            row.setOnClickListener {
                Haptics.light(activity)
                activity.startActivity(Intent(activity, DetailActivity::class.java).apply {
                    putExtra(DetailActivity.EXTRA_REQUEST_ID, r.id)
                })
            }
            row.setOnLongClickListener { showRowActions(r); true }
        }
    }

    /** ~9% accent tint background for the selected-row treatment. */
    private fun accentTint(accent: Int): Int =
        Color.argb(23, Color.red(accent), Color.green(accent), Color.blue(accent))

    internal fun dp(dp: Int): Int = dp(activity.resources, dp)

    // `::prop.isInitialized` is only usable lexically inside the declaring class body
    // (or same-file top level) — never from an extension function, regardless of
    // visibility. These small member wrappers are the fix so the lateinit guards in
    // the split files keep working unchanged.
    internal fun isPausedBannerReady() = ::pausedBanner.isInitialized
    internal fun isFilterContainerReady() = ::filterContainer.isInitialized
    internal fun isPresetStoreReady() = ::presetStore.isInitialized
    internal fun isStatsLabelReady() = ::statsLabel.isInitialized
    internal fun isFiltersTriggerReady() = ::filtersTrigger.isInitialized
    internal fun isQuickChipStripReady() = ::quickChipStrip.isInitialized
}
