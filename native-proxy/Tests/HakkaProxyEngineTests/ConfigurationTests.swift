import XCTest
@testable import HakkaProxyEngine

final class ConfigurationTests: XCTestCase {
    func testRejectsNonLoopbackAndUnboundedResourcesBeforeTransportStarts() throws {
        let recorder = CaptureRecorder { _ in }
        for host in ["0.0.0.0", "localhost", "192.168.1.10"] {
            XCTAssertThrowsError(try ProxyConfiguration(host: host, recorder: recorder))
        }
        for port in [-1, 65536] {
            XCTAssertThrowsError(try ProxyConfiguration(port: port, recorder: recorder))
        }
        for limit in [-1, 1_048_577] {
            XCTAssertThrowsError(try ProxyConfiguration(maxBodyBytes: limit, recorder: recorder))
        }
        for limit in [0, 1025] {
            XCTAssertThrowsError(try ProxyConfiguration(maxConnections: limit, recorder: recorder))
        }
        for timeout in [Int64(0), 61] {
            XCTAssertThrowsError(try ProxyConfiguration(connectTimeoutSeconds: timeout, recorder: recorder))
        }
        for timeout in [Int64(0), 301] {
            XCTAssertThrowsError(try ProxyConfiguration(idleTimeoutSeconds: timeout, recorder: recorder))
        }
    }
}
