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
        manager.emit(state(0, SplitInstallSessionStatus.FAILED))
        assertEquals(listOf(false), firstResults)

        coordinator.install("hakkaInspector", secondResults::add)
        oldTask.setException(IllegalStateException("late failure"))
        assertTrue(secondResults.isEmpty())

        manager.tasks.last().setResult(42)
        manager.emit(state(42, SplitInstallSessionStatus.INSTALLED))
        assertEquals(listOf(true), secondResults)
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
        var registrationFailures = 0
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
                "cancelInstall" -> Tasks.forResult(null)
                "toString" -> "FakeSplitInstallManager"
                "hashCode" -> System.identityHashCode(proxy)
                "equals" -> proxy === args[0]
                else -> throw UnsupportedOperationException(method.name)
            }
        }

        fun emit(state: SplitInstallSessionState) {
            listeners.toList().forEach { it.onStateUpdate(state) }
        }
    }
}
