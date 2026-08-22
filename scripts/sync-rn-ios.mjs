#!/usr/bin/env node
// Sync the React Native package's iOS sources from the canonical Swift package.
//
// The npm package (hakka-react-native) ships self-contained iOS sources, so it
// cannot reference ../../ios/Sources at publish time — it needs its own physical
// copy. To stop the two copies from drifting (which has shipped real bugs, e.g.
// a wrong Mach task-info flavor and a mismatched auth-challenge disposition),
// the RN copy is GENERATED from the tested canonical package, never hand-edited.
//
// Usage:
//   node scripts/sync-rn-ios.mjs            regenerate the RN copy (writes files)
//   node scripts/sync-rn-ios.mjs --check    verify the RN copy is in sync (CI gate)
//
// Canonical lives in multiple SPM modules (HakkaCommon, HakkaNetwork, …); the RN
// pod compiles everything as ONE module, so two deliberate omissions apply:
//   - Common/Headers.swift   — its `firstValue` extension is also defined in
//                              Network/RequestBuilder.swift; in a single module
//                              keeping both is a duplicate-symbol error.
//   - Common/OtelExport.swift — unused by the RN surface; keeps the bridge lean.
// RNHakkaCoreBridge.swift is RN-owned and never touched by this script.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CANON_ROOT = join(repoRoot, 'ios/Sources')
const RN_ROOT = join(repoRoot, 'packages/hakka-react-native/ios')

// canonical path (under ios/Sources) -> RN path (under packages/hakka-react-native/ios)
const MANIFEST = [
  ['Common/BreakpointEngine.swift', 'Core/BreakpointEngine.swift'],
  ['Common/BridgeClient.swift', 'Core/BridgeClient.swift'],
  ['Common/BridgeClient+Encoding.swift', 'Core/BridgeClient+Encoding.swift'],
  ['Common/BridgeDiscovery.swift', 'Core/BridgeDiscovery.swift'],
  ['Common/NWBridgeHostBrowser.swift', 'Core/NWBridgeHostBrowser.swift'],
  ['Common/BreakpointWireEdits.swift', 'Core/BreakpointWireEdits.swift'],
  ['Common/ControlCommand.swift', 'Core/ControlCommand.swift'],
  ['Common/ControlCommandApply.swift', 'Core/ControlCommandApply.swift'],
  ['Common/ControlCommandParsing.swift', 'Core/ControlCommandParsing.swift'],
  ['Common/ControlCommandParsingBreakpoint.swift', 'Core/ControlCommandParsingBreakpoint.swift'],
  ['Common/ControlCommandParsingMock.swift', 'Core/ControlCommandParsingMock.swift'],
  ['Common/Config.swift', 'Core/Config.swift'],
  ['Common/Contract.swift', 'Core/Contract.swift'],
  ['Common/Delegate.swift', 'Core/Delegate.swift'],
  ['Common/Export/CurlExporter.swift', 'Core/Export/CurlExporter.swift'],
  ['Common/Export/HarExporter.swift', 'Core/Export/HarExporter.swift'],
  ['Common/Export/MockRuleBuilder.swift', 'Core/Export/MockRuleBuilder.swift'],
  ['Common/Export/ReportBuilder.swift', 'Core/Export/ReportBuilder.swift'],
  ['Common/Export/TextExporter.swift', 'Core/Export/TextExporter.swift'],
  ['Common/HakkaLog.swift', 'Core/HakkaLog.swift'],
  ['Common/HealthReportGenerator.swift', 'Core/HealthReportGenerator.swift'],
  ['Common/LogStore.swift', 'Core/LogStore.swift'],
  ['Common/MockEngine.swift', 'Core/MockEngine.swift'],
  ['Common/MockEngineMatching.swift', 'Core/MockEngineMatching.swift'],
  ['Common/MockFailure.swift', 'Core/MockFailure.swift'],
  ['Common/MockRuleModify.swift', 'Core/MockRuleModify.swift'],
  ['Common/MockRuleTypes.swift', 'Core/MockRuleTypes.swift'],
  ['Common/NetworkRequest.swift', 'Core/NetworkRequest.swift'],
  ['Common/Plugin.swift', 'Core/Plugin.swift'],
  ['Common/PluginRegistry.swift', 'Core/PluginRegistry.swift'],
  ['Common/RecordSink.swift', 'Core/RecordSink.swift'],
  ['Common/RetentionPolicy.swift', 'Core/RetentionPolicy.swift'],
  ['Common/StorageAdapter.swift', 'Core/StorageAdapter.swift'],
  ['Common/StorageSnapshot.swift', 'Core/StorageSnapshot.swift'],
  ['Common/ThrottleEngine.swift', 'Core/ThrottleEngine.swift'],
  ['Common/UrlCodec.swift', 'Core/UrlCodec.swift'],
  ['Network/CaptureProcessor.swift', 'Core/CaptureProcessor.swift'],
  ['Network/Interceptor.swift', 'Core/Interceptor.swift'],
  ['Network/InterceptorPluginContext.swift', 'Core/InterceptorPluginContext.swift'],
  ['Network/OSLogBridge.swift', 'Core/OSLogBridge.swift'],
  ['Network/Redaction.swift', 'Core/Redaction.swift'],
  ['Network/RequestBuilder.swift', 'Core/RequestBuilder.swift'],
  ['Network/URLProtocol.swift', 'Core/URLProtocol.swift'],
  ['Network/URLSessionSwizzle.swift', 'Core/URLSessionSwizzle.swift'],
  ['Network/WebSocketMonitor.swift', 'Core/WebSocketMonitor.swift'],
  ['UI/ShakeDetector.swift', 'Core/ShakeDetector.swift'],
  ['Performance/HakkaPerformance.swift', 'Performance/HakkaPerformance.swift'],
]

// RN-owned files that are NOT generated (used to flag stray Core files).
const RN_OWNED = new Set(['RNHakkaCoreBridge.swift'])

function header(canonRel) {
  return (
    `// @generated — do not edit. Synced from ios/Sources/${canonRel}\n` +
    `// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run \`just sync-ios\`.\n\n`
  )
}

function expectedContent(canonRel) {
  return header(canonRel) + readFileSync(join(CANON_ROOT, canonRel), 'utf8')
}

const check = process.argv.includes('--check')
const drifted = []
const missingCanonical = []

for (const [canonRel, rnRel] of MANIFEST) {
  if (!existsSync(join(CANON_ROOT, canonRel))) {
    missingCanonical.push(canonRel)
    continue
  }
  const expected = expectedContent(canonRel)
  const destPath = join(RN_ROOT, rnRel)
  const actual = existsSync(destPath) ? readFileSync(destPath, 'utf8') : null

  if (actual === expected) continue

  if (check) {
    drifted.push(rnRel)
  } else {
    mkdirSync(dirname(destPath), { recursive: true })
    writeFileSync(destPath, expected)
    console.log(`  synced  ${rnRel}`)
  }
}

if (missingCanonical.length > 0) {
  console.error('ERROR: manifest references canonical files that do not exist:')
  for (const f of missingCanonical) console.error(`  ios/Sources/${f}`)
  process.exit(1)
}

if (check) {
  if (drifted.length > 0) {
    console.error(`RN iOS sources are out of sync with ios/Sources (${drifted.length}):`)
    for (const f of drifted) console.error(`  packages/hakka-react-native/ios/${f}`)
    console.error('\nFix: run `just sync-ios` (edit canonical sources, never the RN copy).')
    process.exit(1)
  }
  console.log(`RN iOS sources in sync (${MANIFEST.length} files).`)
} else {
  console.log(`Done. ${MANIFEST.length} files synced from ios/Sources → RN package.`)
  console.log(`RN-owned (untouched): ${[...RN_OWNED].join(', ')}`)
}
