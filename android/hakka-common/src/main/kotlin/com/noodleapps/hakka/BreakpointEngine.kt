package com.noodleapps.hakka

import java.util.concurrent.BlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicInteger

// ── Phase ────────────────────────────────────────────────────────────────────

/**
 * Which phase a breakpoint pauses on:
 * - [REQUEST]  — before the request is sent (before `chain.proceed`).
 * - [RESPONSE] — after the real response returns, before the caller sees it.
 * - [BOTH]     — either phase.
 *
 * Mirrors `BreakpointPhase` in the TypeScript engine.
 */
enum class BreakpointPhase { REQUEST, RESPONSE, BOTH }

// ── Rule model ───────────────────────────────────────────────────────────────

/**
 * A single breakpoint rule.
 *
 * @property id       Unique id (auto-generated or caller-supplied).
 * @property pattern  Substring matched against the request URL.
 * @property method   Optional HTTP method filter (case-insensitive). Null = match all.
 * @property on       Which [BreakpointPhase] to pause on.
 * @property enabled  Whether this rule is active.
 */
data class BreakpointRule(
    val id: String,
    val pattern: String,
    val method: String? = null,
    val on: BreakpointPhase = BreakpointPhase.REQUEST,
    val enabled: Boolean = true,
)

/**
 * Input for adding a new breakpoint (id is optional; one is generated if absent).
 */
data class BreakpointRuleInput(
    val pattern: String,
    val method: String? = null,
    val on: BreakpointPhase = BreakpointPhase.REQUEST,
    val enabled: Boolean = true,
    val id: String? = null,
)

// ── Paused-request snapshots ─────────────────────────────────────────────────

/**
 * The editable request snapshot shown while paused at the request phase.
 * The user may edit [url], [method], [headers], or [body] before resuming.
 */
data class PausedRequest(
    val url: String,
    val method: String,
    val headers: Map<String, String>,
    val body: String?,
)

/**
 * The editable response snapshot shown while paused at the response phase.
 * The user may edit [status], [headers], or [body] before resuming.
 */
data class PausedResponse(
    val status: Int,
    val headers: Map<String, String>,
    val body: String,
)

// ── Paused-entry discriminated union ─────────────────────────────────────────

/** Which phase a [PausedEntry] was paused at — determines which payload field is populated. */
enum class PausedPhase { REQUEST, RESPONSE }

/**
 * A held network event waiting for user action.
 *
 * @property id         Unique id for this pause slot (distinct from the breakpoint id).
 * @property requestId  The network request id (matches [NetworkRequest.id]).
 * @property phase      Whether this is a request-phase or response-phase pause.
 * @property request    Populated only for [PausedPhase.REQUEST] entries.
 * @property response   Populated only for [PausedPhase.RESPONSE] entries.
 */
data class PausedEntry(
    val id: String,
    val requestId: String,
    val phase: PausedPhase,
    val request: PausedRequest? = null,
    val response: PausedResponse? = null,
)

// ── Resume actions ────────────────────────────────────────────────────────────

/** Sealed set of outcomes for a request-phase pause. */
sealed class ResumeRequestAction {
    /** Let the request proceed, optionally replacing fields. */
    data class Resume(val edits: PausedRequestEdits? = null) : ResumeRequestAction()
    /** Abort the request — the interceptor will throw [AbortedException]. */
    object Abort : ResumeRequestAction()
}

/** Sealed set of outcomes for a response-phase pause. */
sealed class ResumeResponseAction {
    /** Return the response to the caller, optionally replacing fields. */
    data class Resume(val edits: PausedResponseEdits? = null) : ResumeResponseAction()
    /** Abort — the interceptor will throw [AbortedException] instead of returning the response. */
    object Abort : ResumeResponseAction()
}

/** Optional edits applied to the request before it is sent. Null field = keep original value. */
data class PausedRequestEdits(
    val url: String? = null,
    val method: String? = null,
    val headers: Map<String, String>? = null,
    val body: String? = null,
)

/** Optional edits applied to the response before it is returned. Null field = keep original value. */
data class PausedResponseEdits(
    val status: Int? = null,
    val headers: Map<String, String>? = null,
    val body: String? = null,
)

/** Thrown by the interceptor when the user aborts a paused request or response. */
class AbortedException(message: String = "Request aborted by breakpoint") : java.io.IOException(message)

// ── Engine ────────────────────────────────────────────────────────────────────

/**
 * BreakpointEngine — pause matching requests/responses so they can be inspected
 * and edited before proceeding, mirroring the TypeScript `BreakpointEngine`.
 *
 * Thread-safety model:
 * - Rule list is guarded by `rulesLock` (ReadWriteLock semantics via `@Synchronized`).
 * - Each paused slot holds a [BlockingQueue] (capacity 1); the OkHttp thread blocks
 *   on [BlockingQueue.take]; the UI thread calls [resume] / [abort] which puts into
 *   the queue and unblocks the network thread.
 * - Multiple requests can be paused concurrently — each gets its own slot.
 *
 * Off by default — [enabled] must be `true` for [matches] to return true.
 */
class BreakpointEngine {

    companion object {
        /** Singleton shared by interceptors and UI. */
        val shared = BreakpointEngine()
    }

    /** Set to false to disable all breakpoints without removing rules. Default: false. */
    @Volatile var enabled: Boolean = false

    private val rules = mutableListOf<BreakpointRule>()
    private val rulesLock = Any()
    private val idCounter = AtomicInteger(0)

    // pauseId -> PausedSlot
    private val pendingSlots = ConcurrentHashMap<String, PausedSlot<*>>()
    private val slotIdCounter = AtomicInteger(0)

    // Change listeners (called on the thread that modifies state)
    private val listeners = mutableListOf<() -> Unit>()
    private val listenersLock = Any()

    // ── Rules ─────────────────────────────────────────────────────────────────

    /**
     * Adds a breakpoint rule. Returns the assigned rule id. Adding with an id that already
     * exists REPLACES that rule in place (replace-by-id) rather than creating a duplicate —
     * mirrors the TypeScript `BreakpointEngine.addBreakpoint` contract used by the
     * control-frame bridge (`hakka-core`'s `breakpoint.add`).
     */
    fun addBreakpoint(input: BreakpointRuleInput): String {
        val id = input.id ?: "bp_${idCounter.incrementAndGet()}"
        val rule = BreakpointRule(
            id = id,
            pattern = input.pattern,
            method = input.method,
            on = input.on,
            enabled = input.enabled,
        )
        synchronized(rulesLock) {
            val existingIndex = rules.indexOfFirst { it.id == id }
            if (existingIndex >= 0) {
                rules[existingIndex] = rule
            } else {
                rules.add(rule)
            }
        }
        notifyListeners()
        return id
    }

    /** Removes a breakpoint rule by id. */
    fun removeBreakpoint(id: String) {
        synchronized(rulesLock) { rules.removeAll { it.id == id } }
        notifyListeners()
    }

    /** Enables or disables a rule by id. */
    fun setEnabled(id: String, ruleEnabled: Boolean) {
        synchronized(rulesLock) {
            val idx = rules.indexOfFirst { it.id == id }
            if (idx >= 0) rules[idx] = rules[idx].copy(enabled = ruleEnabled)
        }
        notifyListeners()
    }

    /** Returns a snapshot of all breakpoint rules. */
    fun getBreakpoints(): List<BreakpointRule> = synchronized(rulesLock) { rules.toList() }

    /** Removes all rules. */
    fun clearBreakpoints() {
        synchronized(rulesLock) { rules.clear() }
        notifyListeners()
    }

    // ── Matching ──────────────────────────────────────────────────────────────

    /**
     * Returns true when:
     * 1. [enabled] is true, AND
     * 2. an enabled rule with a matching [BreakpointPhase] and URL/method exists.
     *
     * The [BreakpointPhase.BOTH] rule matches either phase argument.
     * Called from the OkHttp interceptor thread — must be fast; no I/O.
     */
    fun matches(url: String, method: String, phase: BreakpointPhase): Boolean {
        if (!enabled) return false
        val m = method.uppercase()
        return synchronized(rulesLock) {
            rules.any { rule ->
                rule.enabled &&
                    (rule.on == phase || rule.on == BreakpointPhase.BOTH) &&
                    url.contains(rule.pattern) &&
                    (rule.method == null || rule.method.uppercase() == m)
            }
        }
    }

    // ── Pausing ───────────────────────────────────────────────────────────────

    /**
     * Pause a request before it is sent. Blocks the calling thread until the UI
     * calls [resumeRequest] or [abort].
     *
     * Called from the OkHttp interceptor thread (a background thread).
     * Safe to block — OkHttp allocates one thread per in-flight call.
     *
     * @return the [ResumeRequestAction] chosen by the user.
     * @throws InterruptedException if the thread is interrupted while waiting.
     */
    @Throws(InterruptedException::class)
    fun pauseRequest(requestId: String, snapshot: PausedRequest): ResumeRequestAction {
        val pauseId = "pause_req_${slotIdCounter.incrementAndGet()}"
        val slot = PausedSlot<ResumeRequestAction>(pauseId, requestId, PausedPhase.REQUEST, snapshot, null)
        pendingSlots[pauseId] = slot
        notifyListeners()
        return try {
            slot.queue.take() // BLOCKS until UI resolves
        } finally {
            pendingSlots.remove(pauseId)
            notifyListeners()
        }
    }

    /**
     * Pause a response after it has returned from the network but before it reaches
     * the caller. Blocks until the UI calls [resumeResponse] or [abort].
     */
    @Throws(InterruptedException::class)
    fun pauseResponse(requestId: String, snapshot: PausedResponse): ResumeResponseAction {
        val pauseId = "pause_resp_${slotIdCounter.incrementAndGet()}"
        val slot = PausedSlot<ResumeResponseAction>(pauseId, requestId, PausedPhase.RESPONSE, null, snapshot)
        pendingSlots[pauseId] = slot
        notifyListeners()
        return try {
            @Suppress("UNCHECKED_CAST")
            (slot as PausedSlot<ResumeResponseAction>).queue.take()
        } finally {
            pendingSlots.remove(pauseId)
            notifyListeners()
        }
    }

    /**
     * Resolve a request-phase pause. Called from the UI thread.
     * Unblocks the OkHttp thread for the given [pauseId].
     */
    fun resumeRequest(pauseId: String, edits: PausedRequestEdits? = null) {
        @Suppress("UNCHECKED_CAST")
        val slot = pendingSlots[pauseId] as? PausedSlot<ResumeRequestAction> ?: return
        slot.queue.offer(ResumeRequestAction.Resume(edits))
    }

    /**
     * Resolve a response-phase pause. Called from the UI thread.
     */
    fun resumeResponse(pauseId: String, edits: PausedResponseEdits? = null) {
        @Suppress("UNCHECKED_CAST")
        val slot = pendingSlots[pauseId] as? PausedSlot<ResumeResponseAction> ?: return
        slot.queue.offer(ResumeResponseAction.Resume(edits))
    }

    /**
     * Abort any paused entry (request or response phase). Called from the UI thread.
     * The interceptor will throw [AbortedException].
     */
    fun abort(pauseId: String) {
        val slot = pendingSlots[pauseId] ?: return
        when (slot.phase) {
            PausedPhase.REQUEST -> {
                @Suppress("UNCHECKED_CAST")
                (slot as PausedSlot<ResumeRequestAction>).queue.offer(ResumeRequestAction.Abort)
            }
            PausedPhase.RESPONSE -> {
                @Suppress("UNCHECKED_CAST")
                (slot as PausedSlot<ResumeResponseAction>).queue.offer(ResumeResponseAction.Abort)
            }
        }
    }

    /** Resume all paused entries without edits (used on teardown / engine disable). */
    fun resumeAll() {
        for ((_, slot) in pendingSlots) {
            when (slot.phase) {
                PausedPhase.REQUEST -> {
                    @Suppress("UNCHECKED_CAST")
                    (slot as PausedSlot<ResumeRequestAction>).queue.offer(ResumeRequestAction.Resume())
                }
                PausedPhase.RESPONSE -> {
                    @Suppress("UNCHECKED_CAST")
                    (slot as PausedSlot<ResumeResponseAction>).queue.offer(ResumeResponseAction.Resume())
                }
            }
        }
    }

    // ── State queries ─────────────────────────────────────────────────────────

    /** Returns a snapshot of all currently paused entries, for UI display. */
    fun getPaused(): List<PausedEntry> = pendingSlots.values.map { it.toEntry() }

    /** True when at least one request is currently paused. */
    fun hasPaused(): Boolean = pendingSlots.isNotEmpty()

    // ── Listeners ─────────────────────────────────────────────────────────────

    /**
     * Subscribe to state changes (rules added/removed, requests paused/resumed).
     * The listener is called on whichever thread made the change.
     * Returns an unsubscribe lambda.
     */
    fun subscribe(listener: () -> Unit): () -> Unit {
        synchronized(listenersLock) { listeners.add(listener) }
        return { synchronized(listenersLock) { listeners.remove(listener) } }
    }

    private fun notifyListeners() {
        val snapshot = synchronized(listenersLock) { listeners.toList() }
        snapshot.forEach { it() }
    }
}

// ── Internal slot ─────────────────────────────────────────────────────────────

/**
 * Internal holder for a single paused network event.
 * The [queue] (capacity 1) is used for blocking rendezvous: the network thread
 * blocks on [BlockingQueue.take], the UI thread unblocks it via [BlockingQueue.offer].
 */
private class PausedSlot<T>(
    val id: String,
    val requestId: String,
    val phase: PausedPhase,
    val requestSnapshot: PausedRequest?,
    val responseSnapshot: PausedResponse?,
) {
    val queue: BlockingQueue<T> = LinkedBlockingQueue(1)

    fun toEntry(): PausedEntry = PausedEntry(
        id = id,
        requestId = requestId,
        phase = phase,
        request = requestSnapshot,
        response = responseSnapshot,
    )
}
