package com.noodleapps.hakka.rn

import android.content.Context
import com.google.android.gms.tasks.TaskExecutors
import com.google.android.play.core.splitcompat.SplitCompat
import com.google.android.play.core.splitinstall.SplitInstallManager
import com.google.android.play.core.splitinstall.SplitInstallManagerFactory
import com.google.android.play.core.splitinstall.SplitInstallRequest
import com.google.android.play.core.splitinstall.SplitInstallSessionState
import com.google.android.play.core.splitinstall.SplitInstallStateUpdatedListener
import com.google.android.play.core.splitinstall.model.SplitInstallSessionStatus
import java.util.concurrent.Executor

/** Coordinates an app-owned on-demand inspector feature for React Native hosts. */
internal object PlayInspectorDelivery {
    private val lock = Any()
    @Volatile
    private var coordinator: PlayInspectorInstallCoordinator? = null

    /** Returns whether Play Feature Delivery is linked for a non-blank configured module name. */
    fun canInstall(context: Context, requestedModuleName: String): Boolean {
        if (requestedModuleName.isBlank()) return false
        return try {
            SplitInstallManagerFactory.create(context.applicationContext)
            true
        } catch (_: LinkageError) {
            false
        } catch (_: Exception) {
            false
        }
    }

    /** Resolves every coalesced request after Play installs, cancels, or rejects the feature. */
    fun install(context: Context, requestedModuleName: String, completion: (Boolean) -> Unit) {
        val applicationContext = context.applicationContext
        val activeCoordinator = try {
            synchronized(lock) {
                coordinator ?: PlayInspectorInstallCoordinator(
                    SplitInstallManagerFactory.create(applicationContext),
                    installSplit = { SplitCompat.install(applicationContext) },
                ).also { coordinator = it }
            }
        } catch (_: LinkageError) {
            completion(false)
            return
        } catch (_: Exception) {
            completion(false)
            return
        }
        activeCoordinator.install(requestedModuleName, completion)
    }

    fun cancelPending() {
        coordinator?.cancelPending()
    }

    /** Makes newly installed split resources available to the current React Native Activity. */
    fun installActivity(context: Context) {
        try {
            SplitCompat.installActivity(context)
        } catch (_: LinkageError) {
            // Bundled inspector hosts intentionally do not ship Play Feature Delivery.
        } catch (_: Exception) {
            // Presentation still reports its own result when Play cannot update this Activity.
        }
    }
}

/** One manager-backed install lifecycle. The token prevents callbacks from older tasks finishing a new attempt. */
internal class PlayInspectorInstallCoordinator(
    private val manager: SplitInstallManager,
    private val installSplit: () -> Boolean,
    private val callbackExecutor: Executor = TaskExecutors.MAIN_THREAD,
) {
    private val lock = Any()
    private val pending = mutableListOf<(Boolean) -> Unit>()
    private var activeAttempt: Attempt? = null
    private var nextToken = 0L

    private data class Attempt(
        val token: Long,
        val moduleName: String,
        val listener: SplitInstallStateUpdatedListener,
        var sessionId: Int? = null,
    )

    fun install(moduleName: String, completion: (Boolean) -> Unit) {
        if (moduleName.isBlank()) {
            completion(false)
            return
        }
        val isInstalled = try {
            moduleName in manager.installedModules
        } catch (_: LinkageError) {
            completion(false)
            return
        } catch (_: Exception) {
            completion(false)
            return
        }
        if (isInstalled) {
            completion(loadInstalledSplit())
            return
        }

        var attemptToStart: Attempt? = null
        var rejectDifferentModule = false
        synchronized(lock) {
            val active = activeAttempt
            if (active != null) {
                if (active.moduleName == moduleName) pending.add(completion)
                else rejectDifferentModule = true
            } else {
                pending.add(completion)
                val token = ++nextToken
                val attempt = Attempt(
                    token = token,
                    moduleName = moduleName,
                    listener = SplitInstallStateUpdatedListener { state -> handleState(token, state) },
                )
                activeAttempt = attempt
                attemptToStart = attempt
            }
        }
        if (rejectDifferentModule) {
            completion(false)
            return
        }
        attemptToStart?.let(::start)
    }

    private fun start(attempt: Attempt) {
        try {
            manager.registerListener(attempt.listener)
            val request = SplitInstallRequest.newBuilder().addModule(attempt.moduleName).build()
            manager.startInstall(request)
                .addOnSuccessListener(callbackExecutor) { id ->
                    if (id <= 0) {
                        finish(attempt.token, isModuleInstalled(attempt.moduleName))
                    } else {
                        synchronized(lock) {
                            activeAttempt?.takeIf { it.token == attempt.token }?.sessionId = id
                        }
                    }
                }
                .addOnFailureListener(callbackExecutor) { finish(attempt.token, false) }
        } catch (_: LinkageError) {
            finish(attempt.token, false)
        } catch (_: Exception) {
            finish(attempt.token, false)
        }
    }

    private fun handleState(token: Long, state: SplitInstallSessionState) {
        val acceptsState = synchronized(lock) {
            val active = activeAttempt
            active != null && active.token == token && when (val id = active.sessionId) {
                null -> active.moduleName in state.moduleNames()
                else -> state.sessionId() == id
            }
        }
        if (!acceptsState) return

        when (state.status()) {
            SplitInstallSessionStatus.INSTALLED -> finish(token, true)
            SplitInstallSessionStatus.FAILED,
            SplitInstallSessionStatus.CANCELED,
            SplitInstallSessionStatus.CANCELING,
            SplitInstallSessionStatus.REQUIRES_USER_CONFIRMATION,
            -> finish(token, false)
        }
    }

    fun cancelPending() {
        val attempt = synchronized(lock) { activeAttempt } ?: return
        attempt.sessionId?.takeIf { it > 0 }?.let { id ->
            try {
                manager.cancelInstall(id)
            } catch (_: LinkageError) {
                // Completion below still releases every caller.
            } catch (_: Exception) {
                // Completion below still releases every caller.
            }
        }
        finish(attempt.token, false)
    }

    private fun finish(token: Long, installed: Boolean) {
        val attempt: Attempt
        val completions: List<(Boolean) -> Unit>
        synchronized(lock) {
            attempt = activeAttempt?.takeIf { it.token == token } ?: return
            activeAttempt = null
            completions = pending.toList()
            pending.clear()
        }
        try {
            manager.unregisterListener(attempt.listener)
        } catch (_: LinkageError) {
            // Play Feature Delivery may be absent in a bundled host.
        } catch (_: Exception) {
            // A manager can reject unregister after registration failed.
        }
        val available = installed && loadInstalledSplit()
        completions.forEach { it(available) }
    }

    private fun loadInstalledSplit(): Boolean = try {
        installSplit()
    } catch (_: LinkageError) {
        false
    } catch (_: Exception) {
        false
    }

    private fun isModuleInstalled(moduleName: String): Boolean = try {
        moduleName in manager.installedModules
    } catch (_: LinkageError) {
        false
    } catch (_: Exception) {
        false
    }
}
