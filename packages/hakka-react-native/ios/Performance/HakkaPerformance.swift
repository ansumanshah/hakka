// @generated — do not edit. Synced from ios/Sources/Performance/HakkaPerformance.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

#if canImport(Darwin)
import Darwin
#endif
#if canImport(QuartzCore)
import QuartzCore
#endif
#if os(iOS) || os(tvOS)
import UIKit
#endif
#if canImport(HakkaCommon)
import HakkaCommon
#endif

/// Configuration for iOS performance sampling.
public struct HakkaPerformanceConfig: Sendable {
    /// Sampling interval in milliseconds for periodic metrics.
    public let sampleIntervalMs: Int64
    /// Optional session ID attached to every emitted record.
    public let sessionId: String?
    /// Shared tags attached to every emitted record.
    public let tags: [String: String]
    /// Capture frame-based timing metrics.
    public let enableFrameMetrics: Bool
    /// Capture memory metrics.
    public let enableMemoryMetrics: Bool
    /// Capture process CPU metrics.
    public let enableCpuMetrics: Bool
    /// Capture network usage metrics. iOS v1 currently ships as no-op.
    public let enableNetworkUsageMetrics: Bool

    public init(
        sampleIntervalMs: Int64 = 1000,
        sessionId: String? = nil,
        tags: [String: String] = [:],
        enableFrameMetrics: Bool = true,
        enableMemoryMetrics: Bool = true,
        enableCpuMetrics: Bool = true,
        enableNetworkUsageMetrics: Bool = false,
    ) {
        self.sampleIntervalMs = sampleIntervalMs
        self.sessionId = sessionId
        self.tags = tags
        self.enableFrameMetrics = enableFrameMetrics
        self.enableMemoryMetrics = enableMemoryMetrics
        self.enableCpuMetrics = enableCpuMetrics
        self.enableNetworkUsageMetrics = enableNetworkUsageMetrics
    }

    public func withProductionDefaults() -> Self {
        return HakkaPerformanceConfig(
            sampleIntervalMs: sampleIntervalMs >= 1000 ? sampleIntervalMs : 1000,
            sessionId: sessionId,
            tags: tags,
            enableFrameMetrics: enableFrameMetrics,
            enableMemoryMetrics: enableMemoryMetrics,
            enableCpuMetrics: enableCpuMetrics,
            enableNetworkUsageMetrics: enableNetworkUsageMetrics
        )
    }
}

/// Lightweight iOS performance coordinator.
public final class HakkaPerformance: @unchecked Sendable {
    /// `true` here, `false` in the noop module — lets callers detect which variant is linked.
    public static let isAvailable = true

    private let config: HakkaPerformanceConfig
    private let sinks: RecordSinkHub
    private let frameCollector: FrameCollector?
    private let memoryCollector: MemoryCollector?
    private let cpuCollector: CpuCollector?

    private let lock = NSLock()
    private var running = false
    private var timer: DispatchSourceTimer?
    private let schedulePeriodicSampling: Bool

    /// Creates a coordinator with optional test-time sources.
    internal init(
        config: HakkaPerformanceConfig,
        sinks: [RecordSink] = [],
        frameSource: FrameSource? = nil,
        memorySource: MemoryMetricSource? = nil,
        cpuSource: CpuMetricSource? = nil,
        runtimeStateSource: RuntimeStateMetricSource? = nil,
        clock: PerformanceClock = SystemPerformanceClock(),
        schedulePeriodicSampling: Bool = true
    ) {
        self.config = config.withProductionDefaults()
        let sinkHub = RecordSinkHub()
        self.sinks = sinkHub
        self.schedulePeriodicSampling = schedulePeriodicSampling
        for sink in sinks {
            _ = sinkHub.add(sink)
        }

        if self.config.enableFrameMetrics, let source = frameSource {
            self.frameCollector = FrameCollector(
                clock: clock,
                source: source,
                sessionId: config.sessionId,
                tags: config.tags
            )
        } else {
            self.frameCollector = nil
        }

        if self.config.enableMemoryMetrics, let source = memorySource {
            self.memoryCollector = MemoryCollector(
                clock: clock,
                source: source,
                runtimeStateSource: runtimeStateSource,
                sessionId: config.sessionId,
                tags: config.tags
            ) { record in
                sinkHub.emit(record)
            }
        } else {
            self.memoryCollector = nil
        }

        if self.config.enableCpuMetrics, let source = cpuSource {
            self.cpuCollector = CpuCollector(
                clock: clock,
                source: source,
                runtimeStateSource: runtimeStateSource,
                sessionId: config.sessionId,
                tags: config.tags
            ) { record in
                sinkHub.emit(record)
            }
        } else {
            self.cpuCollector = nil
        }
    }

    /// Public configuration initializer. Matches Android builder ergonomics.
    public convenience init(_ configure: (Builder) -> Void = { _ in }) {
        let builder = Builder()
        configure(builder)
        let normalized = builder.config.withProductionDefaults()
        self.init(
            config: normalized,
            sinks: builder.configuredSinks,
            frameSource: normalized.enableFrameMetrics ? FrameSourceFactory.make() : nil,
            memorySource: normalized.enableMemoryMetrics ? DarwinMemoryMetricSource() : nil,
            cpuSource: normalized.enableCpuMetrics ? DarwinCpuMetricSource() : nil,
            runtimeStateSource: DarwinRuntimeStateMetricSource()
        )
    }

    /// Adds a sink for exported metric records.
    public func addSink(_ sink: @escaping RecordSink) -> SinkSubscription {
        sinks.add(sink)
    }

    /// Returns the configured sample interval in milliseconds.
    public func sampleIntervalMs() -> Int64 {
        config.sampleIntervalMs
    }

    /// Starts collectors.
    public func start() {
        lock.lock()
        defer { lock.unlock() }
        guard !running else { return }
        running = true

        frameCollector?.start()
        if schedulePeriodicSampling {
            scheduleSampling()
        }
    }

    /// Stops collectors.
    public func stop() {
        lock.lock()
        guard running else {
            lock.unlock()
            return
        }
        running = false
        let timer = self.timer
        self.timer = nil
        lock.unlock()

        timer?.cancel()
        frameCollector?.stop()
    }

    /// Closes collector work. Present for parity with Android `close()`.
    public func close() {
        stop()
    }

    deinit {
        stop()
    }

    /// Whether the coordinator is actively collecting.
    public var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }

    /// Flushes in-flight sink work.
    @discardableResult
    public func flushSinks(timeoutMs: Int64 = 5_000) -> Bool {
        sinks.flush(timeout: TimeInterval(max(0, timeoutMs)) / 1000.0)
    }

    /// Returns sink drops when delivery is saturated.
    public func droppedSinkRecords() -> Int {
        sinks.droppedCount()
    }

    /// Builds a lightweight health report for enabled performance collectors.
    public func healthReport(
        timestamp: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        sessionId: String? = nil,
        tags: [String: String] = [:]
    ) -> HealthReportRecord {
        let runningNow = isRunning
        let droppedSinkRecords = droppedSinkRecords()
        var reportTags = config.tags
        for (key, value) in tags {
            reportTags[key] = value
        }
        reportTags["component.collector.sampleIntervalMs"] = String(config.sampleIntervalMs)

        return HealthReportGenerator.generate(
            from: [],
            options: HealthReportBuildOptions(
                timestamp: timestamp,
                sessionId: sessionId ?? config.sessionId,
                tags: reportTags,
                componentHealth: [
                    "collector.frame": HealthComponentStatus(
                        status: collectorStatus(
                            enabled: config.enableFrameMetrics,
                            available: frameCollector != nil,
                            running: runningNow
                        )
                    ),
                    "collector.memory": HealthComponentStatus(
                        status: collectorStatus(
                            enabled: config.enableMemoryMetrics,
                            available: memoryCollector != nil,
                            running: runningNow
                        )
                    ),
                    "collector.cpu": HealthComponentStatus(
                        status: collectorStatus(
                            enabled: config.enableCpuMetrics,
                            available: cpuCollector != nil,
                            running: runningNow
                        )
                    ),
                    "collector.networkUsage": HealthComponentStatus(
                        status: config.enableNetworkUsageMetrics ? "unavailable" : "disabled"
                    ),
                    "sink": HealthComponentStatus(
                        status: droppedSinkRecords > 0 ? "dropping" : "ok",
                        droppedCount: Int64(droppedSinkRecords)
                    ),
                ]
            )
        )
    }

    /// Explicit test hook to run one periodic sampling iteration.
    internal func collectOnceForTest() {
        lock.lock()
        guard running else { lock.unlock(); return }
        lock.unlock()
        memoryCollector?.collect()
        cpuCollector?.collect()
        if let frameRecord = frameCollector?.sample() {
            sinks.emit(frameRecord)
        }
    }

    internal static func createForTest(
        config: HakkaPerformanceConfig,
        frameSource: FrameSource?,
        memorySource: MemoryMetricSource?,
        cpuSource: CpuMetricSource?,
        runtimeStateSource: RuntimeStateMetricSource? = nil,
        clock: PerformanceClock = SystemPerformanceClock(),
        schedulePeriodicSampling: Bool = true
    ) -> HakkaPerformance {
        HakkaPerformance(
            config: config,
            frameSource: frameSource,
            memorySource: memorySource,
            cpuSource: cpuSource,
            runtimeStateSource: runtimeStateSource,
            clock: clock,
            schedulePeriodicSampling: schedulePeriodicSampling
        )
    }

    private func collectorStatus(enabled: Bool, available: Bool, running: Bool) -> String {
        if !enabled { return "disabled" }
        if !available { return "unavailable" }
        return running ? "running" : "idle"
    }

    private func scheduleSampling() {
        guard memoryCollector != nil || cpuCollector != nil || frameCollector != nil else { return }

        let interval = DispatchTimeInterval.milliseconds(Int(config.sampleIntervalMs))
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "com.noodleapps.hakka.performance"))
        timer.schedule(deadline: .now() + interval, repeating: interval, leeway: .milliseconds(5))
        timer.setEventHandler { [weak self] in
            self?.collectOnceForTest()
        }
        timer.resume()
        self.timer = timer
    }

    /// Fluent builder, matching existing Android API shape.
    public final class Builder {
        public init() {}

        public var sampleIntervalMs: Int64 = 1000
        public var sessionId: String?
        public var tags: [String: String] = [:]
        public var enableFrameMetrics: Bool = true
        public var enableMemoryMetrics: Bool = true
        public var enableCpuMetrics: Bool = true
        public var enableNetworkUsageMetrics: Bool = false

        var config: HakkaPerformanceConfig {
            HakkaPerformanceConfig(
                sampleIntervalMs: sampleIntervalMs,
                sessionId: sessionId,
                tags: tags,
                enableFrameMetrics: enableFrameMetrics,
                enableMemoryMetrics: enableMemoryMetrics,
                enableCpuMetrics: enableCpuMetrics,
                enableNetworkUsageMetrics: enableNetworkUsageMetrics
            )
        }

        var configuredSinks: [RecordSink] = []

        public func sink(_ sink: @escaping RecordSink) -> Builder {
            configuredSinks.append(sink)
            return self
        }
    }
}

internal protocol PerformanceClock {
    func nowMs() -> Int64
}

internal final class SystemPerformanceClock: PerformanceClock {
    func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}

internal protocol FrameSource {
    func start(onFrame: @escaping (Int64) -> Void)
    func stop()
    func refreshRateHz() -> Double?
}

internal protocol MemoryMetricSource {
    func sample() -> MemoryMetricSample?
}

internal protocol RuntimeStateMetricSource {
    func sample() -> RuntimeStateSample?
}

internal protocol CpuMetricSource {
    func sample(nowMs: Int64) -> CpuMetricSample?
}

internal struct MemoryMetricSample: Sendable {
    let pssBytes: Int64?
    let heapUsedBytes: Int64?
    let heapMaxBytes: Int64?
    let residentBytes: Int64?
    let physicalFootprintBytes: Int64?

    init(
        pssBytes: Int64? = nil,
        heapUsedBytes: Int64? = nil,
        heapMaxBytes: Int64? = nil,
        residentBytes: Int64? = nil,
        physicalFootprintBytes: Int64? = nil
    ) {
        self.pssBytes = pssBytes
        self.heapUsedBytes = heapUsedBytes
        self.heapMaxBytes = heapMaxBytes
        self.residentBytes = residentBytes
        self.physicalFootprintBytes = physicalFootprintBytes
    }
}

internal struct RuntimeStateSample: Sendable {
    let thermalState: String?
    let memoryWarningCount: Int?
    let lastMemoryWarningTimestamp: Int64?

    init(
        thermalState: String? = nil,
        memoryWarningCount: Int? = nil,
        lastMemoryWarningTimestamp: Int64? = nil
    ) {
        self.thermalState = thermalState
        self.memoryWarningCount = memoryWarningCount
        self.lastMemoryWarningTimestamp = lastMemoryWarningTimestamp
    }
}

internal struct CpuMetricSample: Sendable {
    let nowMs: Int64
    let totalCpuMicros: Int64
}

internal final class FrameCollector {
    private let lock = NSLock()
    private let clock: PerformanceClock
    private let source: FrameSource
    private let sessionId: String?
    private let tags: [String: String]
    private let slowFrameFactor = 1.6
    private let frozenFrameFactor = 5.0

    private var running = false
    private var frameCount = 0
    private var jankFrameCount = 0
    private var frozenFrameCount = 0
    private var lastFrameTimeNanos: Int64 = 0
    private var windowStartMs: Int64
    private var frameDurationsMs: [Double] = []

    init(clock: PerformanceClock, source: FrameSource, sessionId: String?, tags: [String: String]) {
        self.clock = clock
        self.source = source
        self.sessionId = sessionId
        self.tags = tags
        self.windowStartMs = clock.nowMs()
    }

    func start() {
        lock.lock()
        guard !running else {
            lock.unlock()
            return
        }
        running = true
        lastFrameTimeNanos = 0
        frameCount = 0
        jankFrameCount = 0
        frozenFrameCount = 0
        frameDurationsMs.removeAll()
        windowStartMs = clock.nowMs()
        source.start(onFrame: handleFrame(_:))
        lock.unlock()
    }

    func stop() {
        lock.lock()
        guard running else {
            lock.unlock()
            return
        }
        running = false
        lock.unlock()
        source.stop()
    }

    func sample() -> FrameMetricRecord? {
        lock.lock()
        defer { lock.unlock() }
        guard running else { return nil }

        let nowMs = clock.nowMs()
        let windowMs = max(1, nowMs - windowStartMs)
        let fps = frameCount == 0 ? 0.0 : (Double(frameCount) * 1000.0) / Double(windowMs)
        let slow = jankFrameCount > 0
        let frozen = frozenFrameCount > 0
        let currentRefreshRateHz = refreshRateHz()
        var metricTags = tags
        metricTags["frameCount"] = String(frameCount)
        metricTags["jankFrameCount"] = String(jankFrameCount)
        metricTags["frozenFrameCount"] = String(frozenFrameCount)
        metricTags["fps"] = String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), fps)
        if let p95 = percentile(frameDurationsMs, percentile: 95) {
            metricTags["frameDurationP95Ms"] = String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), p95)
        }
        if let p99 = percentile(frameDurationsMs, percentile: 99) {
            metricTags["frameDurationP99Ms"] = String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), p99)
        }
        metricTags["jankFrameRate"] = formatFrameRate(jankFrameCount, total: frameCount)
        metricTags["frozenFrameRate"] = formatFrameRate(frozenFrameCount, total: frameCount)

        let record = FrameMetricRecord(
            timestamp: nowMs,
            sessionId: sessionId,
            tags: metricTags,
            durationMs: Double(windowMs),
            refreshRateHz: currentRefreshRateHz,
            slow: slow,
            frozen: frozen
        )

        windowStartMs = nowMs
        frameCount = 0
        jankFrameCount = 0
        frozenFrameCount = 0
        lastFrameTimeNanos = 0
        frameDurationsMs.removeAll()
        return record
    }

    private func handleFrame(_ frameTimeNanos: Int64) {
        lock.lock()
        defer { lock.unlock() }
        guard running else { return }

        guard lastFrameTimeNanos != 0 else {
            lastFrameTimeNanos = frameTimeNanos
            return
        }
        let frameDurationMs = Double(frameTimeNanos - lastFrameTimeNanos) / 1_000_000.0
        if frameDurationMs > 0.0 {
            let frameIntervalBudgetMs = budgetMs()
            frameCount += 1
            frameDurationsMs.append(frameDurationMs)
            if frameDurationMs >= frameIntervalBudgetMs * slowFrameFactor {
                jankFrameCount += 1
            }
            if frameDurationMs >= frameIntervalBudgetMs * frozenFrameFactor {
                frozenFrameCount += 1
            }
        }
        lastFrameTimeNanos = frameTimeNanos
    }

    private func refreshRateHz() -> Double? {
        guard let value = source.refreshRateHz(), value > 0 else { return nil }
        return value
    }

    private func budgetMs() -> Double {
        guard let refreshRateHz = refreshRateHz() else { return 16.666_666_7 }
        return 1000.0 / refreshRateHz
    }

    private func percentile(_ values: [Double], percentile: Double) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let rank = Int(ceil((percentile / 100.0) * Double(sorted.count))) - 1
        let index = min(max(rank, 0), sorted.count - 1)
        return sorted[index]
    }

    private func formatFrameRate(_ count: Int, total: Int) -> String {
        let rate = total <= 0 ? 0.0 : Double(count) / Double(total)
        return String(format: "%.4f", locale: Locale(identifier: "en_US_POSIX"), rate)
    }
}

internal final class MemoryCollector: @unchecked Sendable {
    private let clock: PerformanceClock
    private let source: MemoryMetricSource
    private let runtimeStateSource: RuntimeStateMetricSource?
    private let sessionId: String?
    private let tags: [String: String]
    private let emit: (MemoryMetricRecord) -> Void

    init(
        clock: PerformanceClock,
        source: MemoryMetricSource,
        runtimeStateSource: RuntimeStateMetricSource?,
        sessionId: String?,
        tags: [String: String],
        emit: @escaping (MemoryMetricRecord) -> Void,
    ) {
        self.clock = clock
        self.source = source
        self.runtimeStateSource = runtimeStateSource
        self.sessionId = sessionId
        self.tags = tags
        self.emit = emit
    }

    func collect() {
        guard let sample = source.sample() else { return }
        let metricTags = memoryTags(for: sample, runtimeState: runtimeStateSource?.sample())
        emit(
            MemoryMetricRecord(
                timestamp: clock.nowMs(),
                sessionId: sessionId,
                tags: metricTags,
                pssBytes: sample.pssBytes,
                heapUsedBytes: sample.heapUsedBytes,
                heapMaxBytes: sample.heapMaxBytes
            )
        )
    }

    private func memoryTags(for sample: MemoryMetricSample, runtimeState: RuntimeStateSample?) -> [String: String] {
        var metricTags = tags
        if let residentBytes = sample.residentBytes {
            metricTags["residentBytes"] = String(residentBytes)
        }
        if let physicalFootprintBytes = sample.physicalFootprintBytes {
            metricTags["physicalFootprintBytes"] = String(physicalFootprintBytes)
        }
        putRuntimeStateTags(runtimeState, into: &metricTags)
        return metricTags
    }
}

internal final class CpuCollector: @unchecked Sendable {
    private let clock: PerformanceClock
    private let source: CpuMetricSource
    private let runtimeStateSource: RuntimeStateMetricSource?
    private let sessionId: String?
    private let tags: [String: String]
    private let emit: (CpuMetricRecord) -> Void
    private var previousSample: CpuMetricSample?

    init(
        clock: PerformanceClock,
        source: CpuMetricSource,
        runtimeStateSource: RuntimeStateMetricSource?,
        sessionId: String?,
        tags: [String: String],
        emit: @escaping (CpuMetricRecord) -> Void,
    ) {
        self.clock = clock
        self.source = source
        self.runtimeStateSource = runtimeStateSource
        self.sessionId = sessionId
        self.tags = tags
        self.emit = emit
    }

    func collect() {
        let nowSample = source.sample(nowMs: clock.nowMs())
        guard let nowSample else { return }

        guard let previous = previousSample else {
            previousSample = nowSample
            return
        }

        let deltaMicros = nowSample.totalCpuMicros - previous.totalCpuMicros
        let elapsedMs = nowSample.nowMs - previous.nowMs
        guard deltaMicros > 0, elapsedMs > 0 else {
            previousSample = nowSample
            return
        }

        let cpuPercent = (Double(deltaMicros) * 100.0) / Double(elapsedMs * 1000)
        emit(
            CpuMetricRecord(
                timestamp: nowSample.nowMs,
                sessionId: sessionId,
                tags: cpuTags(
                    windowElapsedMs: elapsedMs,
                    windowCpuMicros: deltaMicros,
                    totalCpuMicros: nowSample.totalCpuMicros,
                    runtimeState: runtimeStateSource?.sample()
                ),
                processCpuPercent: cpuPercent
            )
        )
        previousSample = nowSample
    }

    private func cpuTags(
        windowElapsedMs: Int64,
        windowCpuMicros: Int64,
        totalCpuMicros: Int64,
        runtimeState: RuntimeStateSample?
    ) -> [String: String] {
        var metricTags = tags
        metricTags["cpuWindowMs"] = String(windowElapsedMs)
        metricTags["cpuElapsedMicros"] = String(windowCpuMicros)
        metricTags["cpuTotalMicros"] = String(totalCpuMicros)
        putRuntimeStateTags(runtimeState, into: &metricTags)
        return metricTags
    }
}

private func putRuntimeStateTags(_ runtimeState: RuntimeStateSample?, into tags: inout [String: String]) {
    guard let runtimeState else { return }
    if let thermalState = runtimeState.thermalState {
        tags["thermal.state"] = thermalState
    }
    if let memoryWarningCount = runtimeState.memoryWarningCount {
        tags["memory.warningCount"] = String(memoryWarningCount)
    }
    if let lastMemoryWarningTimestamp = runtimeState.lastMemoryWarningTimestamp {
        tags["memory.lastWarningTimestamp"] = String(lastMemoryWarningTimestamp)
    }
}

internal enum FrameSourceFactory {
    static func make() -> FrameSource? {
#if canImport(QuartzCore) && (os(iOS) || os(tvOS))
        return CADisplayLinkFrameSource.create()
#else
        return nil
#endif
    }
}

#if canImport(QuartzCore) && (os(iOS) || os(tvOS))
final class CADisplayLinkFrameSource: NSObject, FrameSource {
    private let lock = NSLock()
    private var callback: ((Int64) -> Void)?
    private var displayLink: CADisplayLink?
    private var running = false

    static func create() -> FrameSource? {
        CADisplayLinkFrameSource()
    }

    func start(onFrame: @escaping (Int64) -> Void) {
        lock.lock()
        guard !running else {
            lock.unlock()
            return
        }
        running = true
        callback = onFrame
        lock.unlock()

        let link = CADisplayLink(target: self, selector: #selector(didReceiveFrame))
        link.add(to: .main, forMode: .common)
        lock.lock()
        displayLink = link
        lock.unlock()
    }

    func stop() {
        lock.lock()
        guard let link = displayLink else {
            running = false
            callback = nil
            lock.unlock()
            return
        }
        displayLink = nil
        running = false
        callback = nil
        lock.unlock()
        link.invalidate()
    }

    func refreshRateHz() -> Double? {
        lock.lock()
        let duration = displayLink?.duration
        lock.unlock()

        if let duration, duration > 0 {
            return 1.0 / duration
        }
        return nil
    }

    @objc private func didReceiveFrame(_ displayLink: CADisplayLink) {
        lock.lock()
        let callback = self.callback
        lock.unlock()

        guard let callback else { return }
        let nanos = Int64(displayLink.timestamp * 1_000_000_000)
        callback(nanos)
    }
}
#endif

internal final class DarwinMemoryMetricSource: MemoryMetricSource {
    func sample() -> MemoryMetricSample? {
        #if canImport(Darwin)
        return sampleWithTaskInfo()
        #else
        return nil
        #endif
    }

    private func sampleWithTaskInfo() -> MemoryMetricSample? {
        #if canImport(Darwin)
        var info = mach_task_basic_info_data_t()
        var count = mach_msg_type_number_t(
            MemoryLayout<mach_task_basic_info_data_t>.size / MemoryLayout<integer_t>.size
        )
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(
                    mach_task_self_,
                    task_flavor_t(MACH_TASK_BASIC_INFO),
                    $0,
                    &count
                )
            }
        }
        guard result == KERN_SUCCESS else { return nil }

        let residentBytes = Self.clampedInt64(info.resident_size)
        return MemoryMetricSample(
            pssBytes: residentBytes,
            heapUsedBytes: residentBytes,
            heapMaxBytes: Self.clampedInt64(info.virtual_size),
            residentBytes: residentBytes,
            physicalFootprintBytes: samplePhysicalFootprintBytes()
        )
        #else
        return nil
        #endif
    }

    private func samplePhysicalFootprintBytes() -> Int64? {
        #if canImport(Darwin)
        var vmInfo = task_vm_info_data_t()
        var vmInfoCount = mach_msg_type_number_t(
            MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size
        )
        let vmInfoResult = withUnsafeMutablePointer(to: &vmInfo) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(vmInfoCount)) {
                task_info(
                    mach_task_self_,
                    task_flavor_t(TASK_VM_INFO),
                    $0,
                    &vmInfoCount
                )
            }
        }
        guard vmInfoResult == KERN_SUCCESS else { return nil }

        return Self.clampedInt64(vmInfo.phys_footprint)
        #else
        return nil
        #endif
    }

    static func clampedInt64(_ value: UInt64) -> Int64 {
        value > UInt64(Int64.max) ? Int64.max : Int64(value)
    }
}

internal final class DarwinCpuMetricSource: CpuMetricSource {
    func sample(nowMs: Int64) -> CpuMetricSample? {
        #if canImport(Darwin)
        var usage = rusage()
        guard getrusage(RUSAGE_SELF, &usage) == 0 else { return nil }

        let totalMicros = microseconds(usage.ru_utime) + microseconds(usage.ru_stime)
        return CpuMetricSample(nowMs: nowMs, totalCpuMicros: totalMicros)
        #else
        return nil
        #endif
    }

    private func microseconds(_ value: timeval) -> Int64 {
        Int64(value.tv_sec) * 1_000_000 + Int64(value.tv_usec)
    }
}

internal final class DarwinRuntimeStateMetricSource: RuntimeStateMetricSource, @unchecked Sendable {
    private let lock = NSLock()
    private let clock: PerformanceClock
    private var memoryWarningCount = 0
    private var lastMemoryWarningTimestamp: Int64?
    #if os(iOS) || os(tvOS)
    private var observer: NSObjectProtocol?
    #endif

    init(clock: PerformanceClock = SystemPerformanceClock()) {
        self.clock = clock
        #if os(iOS) || os(tvOS)
        self.observer = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.recordMemoryWarning()
        }
        #endif
    }

    deinit {
        #if os(iOS) || os(tvOS)
        if let observer {
            NotificationCenter.default.removeObserver(observer)
        }
        #endif
    }

    func sample() -> RuntimeStateSample? {
        let snapshot = memoryWarningSnapshot()
        return RuntimeStateSample(
            thermalState: thermalStateName(ProcessInfo.processInfo.thermalState),
            memoryWarningCount: snapshot.count,
            lastMemoryWarningTimestamp: snapshot.lastTimestamp
        )
    }

    private func recordMemoryWarning() {
        lock.lock()
        memoryWarningCount += 1
        lastMemoryWarningTimestamp = clock.nowMs()
        lock.unlock()
    }

    private func memoryWarningSnapshot() -> (count: Int, lastTimestamp: Int64?) {
        lock.lock()
        defer { lock.unlock() }
        return (memoryWarningCount, lastMemoryWarningTimestamp)
    }

    private func thermalStateName(_ state: ProcessInfo.ThermalState) -> String {
        switch state {
        case .nominal:
            return "nominal"
        case .fair:
            return "fair"
        case .serious:
            return "serious"
        case .critical:
            return "critical"
        @unknown default:
            return "unknown"
        }
    }
}
