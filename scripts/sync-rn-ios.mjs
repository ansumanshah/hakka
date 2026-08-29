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
// pod compiles everything as ONE module, so every canonical file under the dirs
// below must be either in MANIFEST or in ALLOWLIST (with a reason) — an
// unaccounted-for file fails the run instead of silently missing the RN copy.
// RNHakkaCoreBridge.swift is RN-owned and never touched by this script.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CANON_ROOT = join(repoRoot, 'ios/Sources')
const RN_ROOT = join(repoRoot, 'packages/hakka-react-native/ios')

// Top-level ios/Sources dirs the RN bridge draws from. Other dirs (UI/* beyond
// ShakeDetector, NetworkNoop, PerformanceNoop) belong to SPM products RN never
// consumes and are out of scope for the coverage check below.
const SCANNED_CANON_DIRS = ['Common', 'Network', 'Performance']

// Canonical files inside SCANNED_CANON_DIRS deliberately not synced to RN.
// Every entry needs a reason; anything else missing from MANIFEST fails the run.
const ALLOWLIST = new Map([
  [
    'Common/Headers.swift',
    'its `firstValue` extension is also defined in Network/RequestBuilder.swift; in a single module keeping both is a duplicate-symbol error',
  ],
  ['Common/OtelExport.swift', 'unused by the RN surface; keeps the bridge lean'],
  ['Common/ManualCapture.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  ['Common/CookieParser.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  ['Common/GraphQLBodyParser.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  ['Common/HakkaConsole.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  ['Common/SearchQueryCompiler.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  ['Common/SearchQueryParser.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  ['Common/Export/PostmanExporter.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  ['Common/Export/URLSessionExporter.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  [
    'Common/BodyDecoders/BodyDecoderRegistry.swift',
    'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)',
  ],
  [
    'Common/BodyDecoders/BodyDecoders+Builtins.swift',
    'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)',
  ],
  ['Common/BodyDecoders/GrpcWebDecoder.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  [
    'Common/BodyDecoders/GzipDeflateDecoders.swift',
    'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)',
  ],
  ['Common/BodyDecoders/InflateSupport.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  ['Common/BodyDecoders/ProtoReader.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  ['Common/BodyDecoders/ProtobufDetectors.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  [
    'Common/BodyDecoders/ProtobufWireDecoder.swift',
    'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)',
  ],
  ['Common/BodyDecoders/SseDecoder.swift', 'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)'],
  [
    'Common/BodyDecoders/WsFrameDecoderRegistry.swift',
    'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)',
  ],
  [
    'Common/BodyDecoders/WsFrameDecoders+Builtins.swift',
    'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)',
  ],
  [
    'Common/BodyDecoders/WsFrameDecoders+GraphqlWs.swift',
    'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)',
  ],
  [
    'Common/BodyDecoders/WsFrameDecoders+Mqtt.swift',
    'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)',
  ],
  [
    'Common/BodyDecoders/WsFrameDecoders+SocketIO.swift',
    'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)',
  ],
  [
    'Common/BodyDecoders/WsFrameDecoders+Stomp.swift',
    'not referenced by the RN bridge (RNHakkaCoreBridge.swift / Core/*)',
  ],
])

/** Recursively list files under `dir` matching `suffix`, as paths relative to `dir`. */
function walkFiles(dir, suffix) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, suffix).map((f) => join(entry.name, f)))
    } else if (entry.name.endsWith(suffix)) {
      out.push(entry.name)
    }
  }
  return out
}

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
  ['Common/JSONDepthGuard.swift', 'Core/JSONDepthGuard.swift'],
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

// Validate the whole manifest BEFORE writing anything — a missing canonical
// file discovered mid-loop must not leave some RN files regenerated and
// others stale (mixed old/new generated sources).
const missingCanonical = MANIFEST.filter(([canonRel]) => !existsSync(join(CANON_ROOT, canonRel))).map(
  ([canonRel]) => canonRel,
)
if (missingCanonical.length > 0) {
  console.error('ERROR: manifest references canonical files that do not exist:')
  for (const f of missingCanonical) console.error(`  ios/Sources/${f}`)
  process.exit(1)
}

const drifted = []
for (const [canonRel, rnRel] of MANIFEST) {
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

// Every canonical .swift file under SCANNED_CANON_DIRS must be accounted for by
// MANIFEST or ALLOWLIST — otherwise a new file silently never reaches RN.
const manifestCanonSet = new Set(MANIFEST.map(([canonRel]) => canonRel))
const unmappedCanonical = []
for (const dir of SCANNED_CANON_DIRS) {
  for (const rel of walkFiles(join(CANON_ROOT, dir), '.swift')) {
    const canonRel = join(dir, rel)
    if (!manifestCanonSet.has(canonRel) && !ALLOWLIST.has(canonRel)) {
      unmappedCanonical.push(canonRel)
    }
  }
}
if (unmappedCanonical.length > 0) {
  console.error(`ERROR: canonical file(s) neither in MANIFEST nor ALLOWLIST (${unmappedCanonical.length}):`)
  for (const f of unmappedCanonical.sort()) console.error(`  ios/Sources/${f}`)
  console.error('\nFix: add to MANIFEST (RN needs it) or ALLOWLIST with a reason (RN does not).')
  process.exit(1)
}

// Any @generated RN file whose rnRel is no longer in MANIFEST is stale — the
// canonical file it was synced from was renamed or deleted from MANIFEST.
const expectedRnRelSet = new Set(MANIFEST.map(([, rnRel]) => rnRel))
const staleGenerated = []
for (const rnRel of walkFiles(RN_ROOT, '.swift')) {
  if (RN_OWNED.has(rnRel) || expectedRnRelSet.has(rnRel)) continue
  const destPath = join(RN_ROOT, rnRel)
  const content = readFileSync(destPath, 'utf8')
  if (!content.startsWith('// @generated')) continue // not ours to manage

  if (check) {
    staleGenerated.push(rnRel)
  } else {
    rmSync(destPath)
    console.log(`  removed ${rnRel} (stale — no longer in MANIFEST)`)
  }
}

if (check) {
  if (drifted.length > 0 || staleGenerated.length > 0) {
    if (drifted.length > 0) {
      console.error(`RN iOS sources are out of sync with ios/Sources (${drifted.length}):`)
      for (const f of drifted) console.error(`  packages/hakka-react-native/ios/${f}`)
    }
    if (staleGenerated.length > 0) {
      console.error(`Stale generated file(s) no longer in MANIFEST (${staleGenerated.length}):`)
      for (const f of staleGenerated.sort()) console.error(`  packages/hakka-react-native/ios/${f}`)
    }
    console.error('\nFix: run `just sync-ios` (edit canonical sources, never the RN copy).')
    process.exit(1)
  }
  console.log(`RN iOS sources in sync (${MANIFEST.length} files).`)
} else {
  console.log(`Done. ${MANIFEST.length} files synced from ios/Sources → RN package.`)
  console.log(`RN-owned (untouched): ${[...RN_OWNED].join(', ')}`)
}
