import Darwin
import Dispatch
import Foundation

/// A slow consumer cannot block networking or grow the output queue indefinitely.
final class JSONLineWriter: @unchecked Sendable {
    private let queue = DispatchQueue(label: "hakka.proxy.output")
    private let lock = NSLock()
    private var queuedBytes = 0
    private var queuedLines = 0
    private var failed = false
    private var captured = 0
    private var dropped = 0
    private let maximumBytes = 4 * 1_048_576

    init() throws {
        let flags = fcntl(STDOUT_FILENO, F_GETFL)
        guard flags >= 0, fcntl(STDOUT_FILENO, F_SETFL, flags | O_NONBLOCK) >= 0 else {
            throw CommandError.outputUnavailable
        }
    }

    func append<T: Encodable>(_ value: T, flow: Bool = false) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard var data = try? encoder.encode(value) else { return }
        data.append(10)
        lock.lock()
        if flow { captured += 1 }
        if failed || queuedLines >= 128 || data.count > maximumBytes - queuedBytes {
            if flow { dropped += 1 }
            lock.unlock(); return
        }
        queuedLines += 1; queuedBytes += data.count
        lock.unlock()
        let line = data
        queue.async { [self] in
            let success = writeLine(line)
            lock.lock()
            queuedLines -= 1; queuedBytes -= line.count
            if !success { failed = true; if flow { dropped += 1 } }
            lock.unlock()
        }
    }

    var statistics: OutputStatistics {
        lock.lock(); defer { lock.unlock() }
        return OutputStatistics(captured: captured, dropped: dropped, outputFailed: failed)
    }

    func flush(seconds: Double = 3) -> Bool {
        let complete = DispatchSemaphore(value: 0)
        queue.async { complete.signal() }
        return complete.wait(timeout: .now() + seconds) == .success
    }

    private func writeLine(_ data: Data) -> Bool {
        lock.lock(); let isFailed = failed; lock.unlock()
        guard !isFailed else { return false }
        let deadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
        return data.withUnsafeBytes { bytes in
            guard let address = bytes.baseAddress else { return true }
            var offset = 0
            while offset < bytes.count {
                let written = Darwin.write(STDOUT_FILENO, address.advanced(by: offset), bytes.count - offset)
                if written > 0 { offset += written; continue }
                if written < 0 && errno == EINTR { continue }
                guard written < 0, errno == EAGAIN || errno == EWOULDBLOCK,
                      DispatchTime.now().uptimeNanoseconds < deadline else { return false }
                var descriptor = pollfd(fd: STDOUT_FILENO, events: Int16(POLLOUT), revents: 0)
                guard poll(&descriptor, 1, 100) >= 0, descriptor.revents & Int16(POLLERR | POLLHUP) == 0 else {
                    return false
                }
            }
            return true
        }
    }
}

struct OutputStatistics: Encodable {
    let captured: Int
    let dropped: Int
    let outputFailed: Bool
}
