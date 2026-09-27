package com.noodleapps.hakka.rn

import com.google.android.gms.tasks.TaskCompletionSource
import com.google.android.gms.tasks.Tasks
import com.google.android.play.core.splitinstall.SplitInstallManager
import com.google.android.play.core.splitinstall.SplitInstallRequest
import com.google.android.play.core.splitinstall.SplitInstallSessionState
import com.google.android.play.core.splitinstall.SplitInstallStateUpdatedListener
import com.google.android.play.core.splitinstall.model.SplitInstallSessionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Method
import java.lang.reflect.Proxy
import java.util.concurrent.Executor

class PlayInspectorInstallCoordinatorTest {
    @Test
    fun coalescesCallersUntilTheInstalledStateLoadsTheSplit() {
        val manager = FakeSplitInstallManager()
        var splitLoads = 0
        val coordinator = createCoordinator(manager) {
            splitLoads += 1
            true
        }
        val results = mutableListOf<Boolean>()

        coordinator.install("hakkaInspector", results::add)
        coordinator.install("hakkaInspector", results::add)
        assertEquals(1, manager.requests.size)

        manager.tasks.single().setResult(41)
        manager.emit(state(41, SplitInstallSessionStatus.INSTALLED))

        assertEquals(listOf(true, true), results)
        assertEquals(1, splitLoads)
        assertEquals(0, manager.listenerCount)
    }

    @Test
    fun ignoresAStaleTaskFailureAfterANewAttemptStarts() {
        val manager = FakeSplitInstallManager()
        val coordinator = createCoordinator(manager) { true }
        val firstResults = mutableListOf<Boolean>()
        val secondResults = mutableListOf<Boolean>()

        coordinator.install("hakkaInspector", firstResults::add)
        val oldTask = manager.tasks.single()
        coordinator.cancelPending()
        assertEquals(listOf(false), firstResults)

        coordinator.install("hakkaInspector", secondResults::add)
        manager.emit(state(41, SplitInstallSessionStatus.FAILED))
        oldTask.setException(IllegalStateException("late failure"))
        assertTrue(secondResults.isEmpty())

        manager.sessionStates[42] = state(42, SplitInstallSessionStatus.INSTALLED)
        manager.tasks.last().setResult(42)
        assertEquals(listOf(true), secondResults)
    }

    @Test
    fun replaysTheCurrentSessionTerminalStateThatArrivesBeforeTheSessionIdTask() {
        val manager = FakeSplitInstallManager()
        val coordinator = createCoordinator(manager) { true }
        val results = mutableListOf<Boolean>()

        coordinator.install("hakkaInspector", results::add)
        manager.sessionStates[41] = state(41, SplitInstallSessionStatus.INSTALLED)
        manager.emit(state(41, SplitInstallSessionStatus.INSTALLED))
        assertTrue(results.isEmpty())

        manager.tasks.single().setResult(41)

        assertEquals(listOf(true), results)
    }

    @Test
    fun registrationFailureReleasesTheCallerAndAllowsRetry() {
        val manager = FakeSplitInstallManager().apply { registrationFailures = 1 }
        val coordinator = createCoordinator(manager) { true }
        val firstResults = mutableListOf<Boolean>()
        val secondResults = mutableListOf<Boolean>()

        coordinator.install("hakkaInspector", firstResults::add)
        assertEquals(listOf(false), firstResults)

        coordinator.install("hakkaInspector", secondResults::add)
        manager.tasks.single().setResult(7)
        manager.emit(state(7, SplitInstallSessionStatus.INSTALLED))
        assertEquals(listOf(true), secondResults)
    }

    @Test
    fun rejectsAZeroSessionInsteadOfLeavingTheCallerPending() {
        val manager = FakeSplitInstallManager()
        val coordinator = createCoordinator(manager) { true }
        val results = mutableListOf<Boolean>()

        coordinator.install("hakkaInspector", results::add)
        manager.tasks.single().setResult(0)

        assertEquals(listOf(false), results)
        assertEquals(0, manager.listenerCount)
    }

    @Test
    fun acceptsAZeroSessionWhenPlayAlreadyReportsTheModuleInstalled() {
        val manager = FakeSplitInstallManager()
        val coordinator = createCoordinator(manager) { true }
        val results = mutableListOf<Boolean>()

        coordinator.install("hakkaInspector", results::add)
        manager.installedModules.add("hakkaInspector")
        manager.tasks.single().setResult(0)

        assertEquals(listOf(true), results)
        assertEquals(0, manager.listenerCount)
    }

    @Test
    fun anInstalledModuleStillLoadsSplitCompatBeforeReportingAvailability() {
        val manager = FakeSplitInstallManager().apply { installedModules.add("hakkaInspector") }
        var loaded = false
        val coordinator = createCoordinator(manager) {
            loaded = true
            true
        }
        val results = mutableListOf<Boolean>()

        coordinator.install("hakkaInspector", results::add)

        assertTrue(loaded)
        assertEquals(listOf(true), results)
        assertTrue(manager.requests.isEmpty())
    }

    @Test
    fun cancelsAStartedSessionThatReportsItsIdAfterTheCallerIsCancelled() {
        val manager = FakeSplitInstallManager()
        val coordinator = createCoordinator(manager) { true }
        val results = mutableListOf<Boolean>()

        coordinator.install("hakkaInspector", results::add)
        coordinator.cancelPending()

        assertEquals(listOf(false), results)
        assertEquals(emptyList<Int>(), manager.cancelledSessionIds)

        manager.tasks.single().setResult(43)

        assertEquals(listOf(43), manager.cancelledSessionIds)
        assertEquals(0, manager.listenerCount)
    }

    @Test
    fun cancelsTheSessionWhenItsStateCannotBeRead() {
        val manager = FakeSplitInstallManager().apply { stateQueryFails = true }
        val coordinator = createCoordinator(manager) { true }
        val results = mutableListOf<Boolean>()
        coordinator.install("hakkaInspector", results::add)
        manager.tasks.single().setResult(44)
        assertEquals(listOf(false), results)
        assertEquals(listOf(44), manager.cancelledSessionIds)
        assertEquals(0, manager.listenerCount)
    }

    private fun state(sessionId: Int, status: Int): SplitInstallSessionState =
        SplitInstallSessionState.create(
            sessionId,
            status,
            0,
            0,
            0,
            listOf("hakkaInspector"),
            emptyList(),
        )

    private fun createCoordinator(
        manager: FakeSplitInstallManager,
        installSplit: () -> Boolean,
    ): PlayInspectorInstallCoordinator = PlayInspectorInstallCoordinator(
        manager.instance,
        installSplit,
        Executor { command -> command.run() },
    )

    private class FakeSplitInstallManager : InvocationHandler {
        val installedModules = mutableSetOf<String>()
        val requests = mutableListOf<SplitInstallRequest>()
        val tasks = mutableListOf<TaskCompletionSource<Int>>()
        val cancelledSessionIds = mutableListOf<Int>()
        val sessionStates = mutableMapOf<Int, SplitInstallSessionState>()
        var registrationFailures = 0
        var stateQueryFails = false
        private val listeners = linkedSetOf<SplitInstallStateUpdatedListener>()

        val listenerCount: Int get() = listeners.size

        val instance: SplitInstallManager = Proxy.newProxyInstance(
            SplitInstallManager::class.java.classLoader,
            arrayOf(SplitInstallManager::class.java),
            this,
        ) as SplitInstallManager

        override fun invoke(proxy: Any, method: Method, arguments: Array<out Any?>?): Any? {
            val args = arguments.orEmpty()
            return when (method.name) {
                "getInstalledModules" -> installedModules
                "getInstalledLanguages" -> emptySet<String>()
                "registerListener" -> {
                    if (registrationFailures > 0) {
                        registrationFailures -= 1
                        throw IllegalStateException("registration failed")
                    }
                    listeners.add(args[0] as SplitInstallStateUpdatedListener)
                    Unit
                }
                "unregisterListener" -> {
                    listeners.remove(args[0] as SplitInstallStateUpdatedListener)
                    Unit
                }
                "startInstall" -> {
                    requests.add(args[0] as SplitInstallRequest)
                    TaskCompletionSource<Int>().also(tasks::add).task
                }
                "getSessionState" -> if (stateQueryFails) {
                    Tasks.forException<SplitInstallSessionState>(IllegalStateException("state unavailable"))
                } else Tasks.forResult(
                    sessionStates[args[0] as Int]
                        ?: pendingState(args[0] as Int),
                )
                "cancelInstall" -> {
                    cancelledSessionIds += args[0] as Int
                    Tasks.forResult(null)
                }
                "toString" -> "FakeSplitInstallManager"
                "hashCode" -> System.identityHashCode(proxy)
                "equals" -> proxy === args[0]
                else -> throw UnsupportedOperationException(method.name)
            }
        }

        private fun pendingState(sessionId: Int): SplitInstallSessionState =
            SplitInstallSessionState.create(
                sessionId,
                SplitInstallSessionStatus.PENDING,
                0,
                0,
                0,
                listOf("hakkaInspector"),
                emptyList(),
            )

        fun emit(state: SplitInstallSessionState) {
            listeners.toList().forEach { it.onStateUpdate(state) }
        }
    }
}
