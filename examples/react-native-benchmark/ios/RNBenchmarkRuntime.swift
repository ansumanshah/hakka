import Foundation
import React
import MachO
#if canImport(UIKit)
import UIKit
#endif
#if canImport(SwiftUI)
import SwiftUI
#endif
#if canImport(Pulse)
import Pulse
#endif
#if canImport(PulseProxy)
import PulseProxy
#endif
#if canImport(PulseUI)
import PulseUI
#endif
#if canImport(Wormholy)
import Wormholy
#endif

@objc(RNBenchmarkRuntime)
final class RNBenchmarkRuntime: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  override init() {
    #if canImport(PulseProxy)
    NetworkLogger.enableProxy()
    #endif
    #if canImport(Wormholy)
    Wormholy.setEnabled(true)
    Wormholy.swiftyLoad()
    #endif
    super.init()
  }

  @objc func constantsToExport() -> [String: Any] {
    [
      "variant": benchmarkVariant,
      "serverUrl": "http://127.0.0.1:4177",
      "autoRun": ProcessInfo.processInfo.arguments.contains("--hakka-benchmark-autorun"),
      "showUI": ProcessInfo.processInfo.arguments.contains("--hakka-benchmark-show-ui"),
    ]
  }

  @objc(getCapturedCount:rejecter:)
  func getCapturedCount(resolve: RCTPromiseResolveBlock, rejecter: RCTPromiseRejectBlock) {
    let variant = benchmarkVariant
    #if canImport(Pulse)
    if variant == "pulse" {
      resolve((try? LoggerStore.shared.tasks().count) ?? 0)
      return
    }
    #endif
    // Report an unavailable public store count as null; validate through UI exports.
    resolve(nil)
  }

  @objc(getEnvironment:rejecter:)
  func getEnvironment(resolve: RCTPromiseResolveBlock, rejecter: RCTPromiseRejectBlock) {
    let process = ProcessInfo.processInfo
    resolve([
      "targetKind": "ios-simulator-or-device",
      "model": process.hostName,
      "os": process.operatingSystemVersionString,
      "debugBuild": _isDebugAssertConfiguration(),
      "residentMemoryBytes": residentMemoryBytes(),
    ])
  }

  @objc(writeResult:resolver:rejecter:)
  func writeResult(_ json: String, resolver: RCTPromiseResolveBlock, rejecter: RCTPromiseRejectBlock) {
    do {
      let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      let destination = documents.appendingPathComponent("hakka-rn-benchmark-result.json")
      try json.write(to: destination, atomically: true, encoding: .utf8)
      presentInspectorIfRequested()
      resolver(destination.path)
    } catch {
      rejecter("WRITE_RESULT", error.localizedDescription, error)
    }
  }
}

private func presentInspectorIfRequested() {
  guard ProcessInfo.processInfo.arguments.contains("--hakka-benchmark-show-ui") else { return }
  DispatchQueue.main.async {
    #if canImport(PulseUI)
    if benchmarkVariant == "pulse", let controller = activeViewController() {
      controller.present(UIHostingController(rootView: ConsoleView()), animated: true)
      return
    }
    #endif
    #if canImport(Wormholy)
    if benchmarkVariant == "wormholy" {
      NotificationCenter.default.post(name: Notification.Name("wormholy_fire"), object: nil)
    }
    #endif
  }
}

private func activeViewController() -> UIViewController? {
  UIApplication.shared.connectedScenes
    .compactMap { $0 as? UIWindowScene }
    .flatMap(\.windows)
    .first(where: \.isKeyWindow)?
    .rootViewController
}

private let benchmarkVariant: String = {
  #if BENCHMARK_HAKKA
  return "hakka"
  #elseif BENCHMARK_PULSE
  return "pulse"
  #elseif BENCHMARK_WORMHOLY
  return "wormholy"
  #else
  return "baseline"
  #endif
}()

private func residentMemoryBytes() -> Double {
  var info = mach_task_basic_info()
  var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
  let result = withUnsafeMutablePointer(to: &info) {
    $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
      task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
    }
  }
  return result == KERN_SUCCESS ? Double(info.resident_size) : 0
}
