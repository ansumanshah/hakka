import Foundation
import Testing
import HakkaCommon
@testable import HakkaPerformance

@Suite struct HakkaPerformanceTests {
    @Test("Performance collector config clamps sample interval")
    func configClampsSampleInterval() {
        let performance = HakkaPerformance {
            $0.sampleIntervalMs = 250
            $0.enableFrameMetrics = false
            $0.enableMemoryMetrics = false
            $0.enableCpuMetrics = false
            $0.enableNetworkUsageMetrics = false
        }
        #expect(performance.sampleIntervalMs() == 1000)
        performance.close()
    }

    @Test("Frame collector emits slow and frozen tags")
    func frameCollectorReportsFrameHealth() {
        let clock = FakeClock(nowMs: 0)
        let source = FakeFrameSource(refreshRateHz: 60)
        let collector = FrameCollector(
            clock: clock,
            source: source,
            sessionId: "session",
            tags: ["env": "test"]
        )

        collector.start()
        source.emit(0)
        source.emit(16_666_667)
        source.emit(50_000_000)
        source.emit(200_000_000)
        clock.now = 1_000

        let record = collector.sample()
        #expect(record != nil)
        #expect(record?.slow == true)
        #expect(record?.frozen == true)
        #expect(record?.tags["frameCount"] == "2")
        #expect(record?.tags["jankFrameCount"] == "2")
        #expect(record?.tags["env"] == "test")
        #expect(record?.tags["frozenFrameCount"] == "1")
        #expect(record?.tags["frameDurationP95Ms"] == "150.0")
        #expect(record?.tags["frameDurationP99Ms"] == "150.0")
        #expect(record?.tags["jankFrameRate"] == "1.0000")
        #expect(record?.tags["frozenFrameRate"] == "0.5000")
        #expect(record?.sessionId == "session")
        #expect(record?.refreshRateHz == 60)
        collector.stop()
    }

    @Test("Memory collector emits task memory records")
    func memoryCollectorEmitsMemory() {
        let clock = FakeClock(nowMs: 20)
        let emitted = AtomicValue<MemoryMetricRecord>()
        let collector = MemoryCollector(
            clock: clock,
            source: FakeMemoryMetricSource(
                sample: MemoryMetricSample(
                    pssBytes: 1_024_000,
                    heapUsedBytes: 2_048_000,
                    heapMaxBytes: 16_777_216,
                    residentBytes: 1_024_000,
                    physicalFootprintBytes: 2_097_152
                )
            ),
            runtimeStateSource: FakeRuntimeStateMetricSource(
                sample: RuntimeStateSample(
                    thermalState: "serious",
                    memoryWarningCount: 2,
                    lastMemoryWarningTimestamp: 19
                )
            ),
            sessionId: "session",
            tags: ["tier": "test"],
            emit: { emitted.append($0) }
        )

        collector.collect()
        let record = emitted.snapshot().first
        #expect(record != nil)
        #expect(record?.pssBytes == 1_024_000)
        #expect(record?.heapUsedBytes == 2_048_000)
        #expect(record?.heapMaxBytes == 16_777_216)
        #expect(record?.tags["residentBytes"] == "1024000")
        #expect(record?.tags["physicalFootprintBytes"] == "2097152")
        #expect(record?.tags["thermal.state"] == "serious")
        #expect(record?.tags["memory.warningCount"] == "2")
        #expect(record?.tags["memory.lastWarningTimestamp"] == "19")
        #expect(record?.sessionId == "session")
        #expect(record?.timestamp == 20)
    }

    @Test("Darwin memory source clamps oversized Mach counters")
    func darwinMemorySourceClampsOversizedCounters() {
        #expect(DarwinMemoryMetricSource.clampedInt64(UInt64(Int64.max)) == Int64.max)
        #expect(DarwinMemoryMetricSource.clampedInt64(UInt64(Int64.max) + 1) == Int64.max)
    }

    @Test("CPU collector emits process percentage")
    func cpuCollectorEmitsPercent() {
        let clock = FakeClock(nowMs: 0)
        let emitted = AtomicValue<CpuMetricRecord>()
        let collector = CpuCollector(
            clock: clock,
            source: FakeCpuMetricSource(samples: [
                CpuMetricSample(nowMs: 1_000, totalCpuMicros: 100_000),
                CpuMetricSample(nowMs: 2_000, totalCpuMicros: 1_000_000),
            ]),
            runtimeStateSource: FakeRuntimeStateMetricSource(sample: RuntimeStateSample(thermalState: "fair")),
            sessionId: "session",
            tags: [:],
            emit: { emitted.append($0) }
        )

        collector.collect()
        clock.now = 2_000
        collector.collect()

        let record = emitted.snapshot().first
        #expect(record != nil)
        #expect(record?.sessionId == "session")
        #expect(record?.processCpuPercent == 90)
        #expect(record?.tags["cpuWindowMs"] == "1000")
        #expect(record?.tags["cpuElapsedMicros"] == "900000")
        #expect(record?.tags["cpuTotalMicros"] == "1000000")
        #expect(record?.tags["thermal.state"] == "fair")
    }

    @Test("Coordinator stops emitting while not running")
    func coordinatorSuppressesEmissionsWhenStopped() {
        let performance = HakkaPerformance.createForTest(
            config: HakkaPerformanceConfig(
                sampleIntervalMs: 1_000,
                enableFrameMetrics: true,
                enableMemoryMetrics: true,
                enableCpuMetrics: true,
            ),
            frameSource: FakeFrameSource(refreshRateHz: 60),
            memorySource: FakeMemoryMetricSource(
                sample: MemoryMetricSample(pssBytes: 10, heapUsedBytes: 20, heapMaxBytes: 30)
            ),
            cpuSource: FakeCpuMetricSource(
                samples: [
                    CpuMetricSample(nowMs: 1_000, totalCpuMicros: 100),
                    CpuMetricSample(nowMs: 2_000, totalCpuMicros: 200),
                ]
            ),
            clock: FakeClock(nowMs: 1_000),
            schedulePeriodicSampling: false,
        )
        let emitted = AtomicValue<any ContractRecord>()
        let subscription = performance.addSink { record in
            emitted.append(record)
        }

        performance.start()
        performance.stop()
        performance.collectOnceForTest()

        #expect(!performance.isRunning)
        #expect(performance.flushSinks(timeoutMs: 1_000))
        #expect(emitted.isEmpty())
        _ = subscription
    }

    @Test("Performance health report exposes collector status")
    func performanceHealthReportExposesCollectorStatus() {
        let performance = HakkaPerformance.createForTest(
            config: HakkaPerformanceConfig(
                sampleIntervalMs: 1_000,
                sessionId: "configured-session",
                tags: ["scope": "perf"],
                enableFrameMetrics: true,
                enableMemoryMetrics: true,
                enableCpuMetrics: true,
                enableNetworkUsageMetrics: true,
            ),
            frameSource: FakeFrameSource(refreshRateHz: 60),
            memorySource: FakeMemoryMetricSource(
                sample: MemoryMetricSample(pssBytes: 10, heapUsedBytes: 20, heapMaxBytes: 30)
            ),
            cpuSource: FakeCpuMetricSource(samples: []),
            clock: FakeClock(nowMs: 1_000),
            schedulePeriodicSampling: false,
        )

        let idleReport = performance.healthReport(timestamp: 5_000, tags: ["env": "test"])

        #expect(idleReport.timestamp == 5_000)
        #expect(idleReport.sessionId == "configured-session")
        #expect(idleReport.tags["env"] == "test")
        #expect(idleReport.tags["scope"] == "perf")
        #expect(idleReport.tags["component.collector.sampleIntervalMs"] == "1000")
        #expect(idleReport.tags["component.collector.frame.status"] == "idle")
        #expect(idleReport.tags["component.collector.memory.status"] == "idle")
        #expect(idleReport.tags["component.collector.cpu.status"] == "idle")
        #expect(idleReport.tags["component.collector.networkUsage.status"] == "unavailable")
        #expect(idleReport.tags["component.sink.status"] == "ok")
        #expect(idleReport.tags["component.sink.droppedCount"] == "0")

        performance.start()
        let runningReport = performance.healthReport(timestamp: 6_000)
        #expect(runningReport.tags["component.collector.frame.status"] == "running")
        performance.close()
    }

    @Test("Coordinator emits frame, memory, and cpu records via sinks")
    func coordinatorCanCollectMultipleKinds() {
        let clock = FakeClock(nowMs: 1_000)
        let frameSource = FakeFrameSource(refreshRateHz: 60)
        let performance = HakkaPerformance.createForTest(
            config: HakkaPerformanceConfig(
                sampleIntervalMs: 1_000,
                sessionId: "session",
                tags: ["scope": "test"],
                enableFrameMetrics: true,
                enableMemoryMetrics: true,
                enableCpuMetrics: true,
            ),
            frameSource: frameSource,
            memorySource: FakeMemoryMetricSource(
                sample: MemoryMetricSample(pssBytes: 1, heapUsedBytes: 2, heapMaxBytes: 3)
            ),
            cpuSource: FakeCpuMetricSource(
                samples: [
                    CpuMetricSample(nowMs: 1_000, totalCpuMicros: 100),
                    CpuMetricSample(nowMs: 2_000, totalCpuMicros: 300),
                ]
            ),
            clock: clock,
            schedulePeriodicSampling: false,
        )

        let all = AtomicValue<any ContractRecord>()

        let subscription = performance.addSink { record in
            all.append(record)
        }

        performance.start()
        frameSource.emit(0)
        frameSource.emit(16_666_667)
        frameSource.emit(17_000_000)
        performance.collectOnceForTest()
        #expect(performance.flushSinks(timeoutMs: 1_000))
        #expect(all.count() == 2)

        clock.now = 2_000
        performance.collectOnceForTest()
        #expect(performance.flushSinks(timeoutMs: 1_000))
        #expect(all.count() >= 5)
        _ = subscription
    }
}

private final class AtomicValue<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var values: [Value] = []

    func append(_ value: Value) {
        lock.lock()
        values.append(value)
        lock.unlock()
    }

    func snapshot() -> [Value] {
        lock.lock()
        defer { lock.unlock() }
        return values
    }

    func count() -> Int {
        snapshot().count
    }

    func isEmpty() -> Bool {
        snapshot().isEmpty
    }
}

private final class FakeClock: PerformanceClock, @unchecked Sendable {
    var now: Int64

    init(nowMs: Int64) {
        self.now = nowMs
    }

    func nowMs() -> Int64 {
        now
    }
}

private final class FakeFrameSource: FrameSource, @unchecked Sendable {
    private let frameRate: Double?
    private var callback: ((Int64) -> Void)?
    private(set) var started = false
    private(set) var stopped = false

    init(refreshRateHz: Double? = nil) {
        self.frameRate = refreshRateHz
    }

    func start(onFrame: @escaping (Int64) -> Void) {
        started = true
        callback = onFrame
    }

    func stop() {
        stopped = true
        callback = nil
    }

    func refreshRateHz() -> Double? {
        frameRate
    }

    func emit(_ nanos: Int64) {
        callback?(nanos)
    }
}

private final class FakeMemoryMetricSource: MemoryMetricSource, @unchecked Sendable {
    private let sampleValue: MemoryMetricSample

    init(sample: MemoryMetricSample) {
        self.sampleValue = sample
    }

    func sample() -> MemoryMetricSample? {
        sampleValue
    }
}

private final class FakeRuntimeStateMetricSource: RuntimeStateMetricSource, @unchecked Sendable {
    private let sampleValue: RuntimeStateSample?

    init(sample: RuntimeStateSample?) {
        self.sampleValue = sample
    }

    func sample() -> RuntimeStateSample? {
        sampleValue
    }
}

private final class FakeCpuMetricSource: CpuMetricSource, @unchecked Sendable {
    private var remaining: [CpuMetricSample]

    init(samples: [CpuMetricSample]) {
        self.remaining = samples
    }

    func sample(nowMs _: Int64) -> CpuMetricSample? {
        guard remaining.isEmpty == false else { return nil }
        return remaining.removeFirst()
    }
}
