// Export/session/repro-bundle actions — the logic side of Inspector's Export
// and Session menus (see InspectorToolbar.tsx for the buttons that call
// these). Kept free of JSX/Solid signals so it's plain, easily testable async
// logic; Inspector wires it to its own reactive selection/filtered-list state
// via the accessor functions below.
import type { NetworkRequest } from 'hakka-core'
import { buildCurl, buildReproBundle, deserializeSession, serializeReproBundle, serializeSession } from 'hakka-core'

import { copyToClipboard } from '../adapters/clipboard'
import { store } from '../worker'

function downloadBlob(text: string, ext: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = ext.includes('.') ? ext : `hakka-${Date.now()}.${ext}`
  a.click()
  URL.revokeObjectURL(url)
}

// Requests here mirror the store's slim echo (see StoreConfig.slimEcho) and
// are missing requestBody/responseBody. Every export/diff call site hydrates
// through this helper first — one `getBodies` round-trip per export, not one
// per request.
export async function withFullBodies(reqs: NetworkRequest[]): Promise<NetworkRequest[]> {
  if (reqs.length === 0) return reqs
  const bodies = await store().getBodies(reqs.map((r) => r.id))
  if (bodies.size === 0) return reqs
  return reqs.map((r) => {
    const b = bodies.get(r.id)
    return b ? { ...r, requestBody: b.requestBody, responseBody: b.responseBody } : r
  })
}

type ExportFormat = 'har' | 'postman' | 'otel'

// Shared shape behind every HAR/Postman/OTel export (bulk-selection or
// visible-list): hydrate bodies, then hand off to the matching lazy-loaded
// serializer. One definition instead of six near-identical copies.
async function exportFormat(reqs: NetworkRequest[], format: ExportFormat): Promise<void> {
  if (reqs.length === 0) return
  const hydrated = await withFullBodies(reqs)
  if (format === 'har') {
    const { exportHarString } = await import('../exporters')
    downloadBlob(exportHarString(hydrated), 'har')
  } else if (format === 'postman') {
    const { exportPostmanString } = await import('../exporters')
    downloadBlob(exportPostmanString(hydrated), 'postman_collection.json')
  } else {
    const { networkRequestToRecord, recordsToOtelJson } = await import('../exporters')
    const records = hydrated.map((r) => networkRequestToRecord(r))
    downloadBlob(JSON.stringify(recordsToOtelJson(records), null, 2), 'otel.json')
  }
}

export interface InspectorExportActions {
  // ── Multi-select bulk export (main-thread; serializers are lazy) ──
  bulkExportHar: () => Promise<void>
  bulkExportPostman: () => Promise<void>
  bulkExportOtel: () => Promise<void>
  bulkCopyCurl: () => Promise<void>
  // ── Visible (filtered + sorted) list export ──
  exportHar: () => Promise<void>
  exportPostman: () => Promise<void>
  exportOtel: () => Promise<void>
  // ── Session save/load (.hakka file) + repro bundle ──
  saveSession: () => Promise<void>
  downloadReproBundle: () => Promise<void>
  loadSessionFile: (e: Event) => Promise<void>
}

export interface InspectorExportDeps {
  /** Currently multi-selected requests (bulk export scope). */
  getSelected: () => NetworkRequest[]
  /** Currently visible — filtered + sorted — requests (default export scope). */
  getFiltered: () => NetworkRequest[]
  importRequests: (reqs: NetworkRequest[]) => void
}

export function createInspectorExportActions(deps: InspectorExportDeps): InspectorExportActions {
  const bulkCopyCurl = async () => {
    const reqs = await withFullBodies(deps.getSelected())
    if (reqs.length === 0) return
    const curl = reqs.map((r) => buildCurl(r)).join('\n\n')
    void copyToClipboard(curl)
  }

  // ── Reproduce bundle (.hakka-repro) — requests + the mock rules that replay
  // them, over the current filtered list. Same visible-list convention as the
  // exports and session save below. ───────────────────────────────────────
  const downloadReproBundle = async () => {
    const reqs = await withFullBodies(deps.getFiltered())
    const bundle = buildReproBundle(reqs, { meta: { exportedFrom: 'hakka-browser' } })
    downloadBlob(serializeReproBundle(bundle), 'hakka-repro')
  }

  const saveSession = async () => {
    const reqs = await withFullBodies(deps.getFiltered())
    downloadBlob(serializeSession(reqs, { exportedFrom: 'hakka-browser' }), 'hakka')
  }

  const loadSessionFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // allow re-selecting the same file later
    if (!file) return
    try {
      const text = await file.text()
      const { requests } = deserializeSession(text)
      deps.importRequests(requests)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      window.alert(`Could not load session: ${msg}`)
    }
  }

  return {
    bulkExportHar: () => exportFormat(deps.getSelected(), 'har'),
    bulkExportPostman: () => exportFormat(deps.getSelected(), 'postman'),
    bulkExportOtel: () => exportFormat(deps.getSelected(), 'otel'),
    bulkCopyCurl,
    exportHar: () => exportFormat(deps.getFiltered(), 'har'),
    exportPostman: () => exportFormat(deps.getFiltered(), 'postman'),
    exportOtel: () => exportFormat(deps.getFiltered(), 'otel'),
    saveSession,
    downloadReproBundle,
    loadSessionFile,
  }
}
