import Darwin
import Foundation

/// Active IPv4 interfaces supply device setup addresses; loopback is used by apps on this Mac.
enum ProxyDeviceAddress {
    static func activeAddresses() -> [String] {
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0 else { return [] }
        defer { freeifaddrs(interfaces) }
        var addresses = Set<String>()
        var cursor = interfaces
        while let entry = cursor {
            defer { cursor = entry.pointee.ifa_next }
            guard let address = entry.pointee.ifa_addr,
                  address.pointee.sa_family == UInt8(AF_INET),
                  entry.pointee.ifa_flags & UInt32(IFF_UP) != 0,
                  entry.pointee.ifa_flags & UInt32(IFF_LOOPBACK) == 0 else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                let value = host.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }
                addresses.insert(String(decoding: value, as: UTF8.self))
            }
        }
        return addresses.sorted()
    }
}
