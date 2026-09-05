/**
 * Wires the six `hakka-browser/elements` custom elements from index.html into
 * a working devtools panel — no `<hakka-inspector>` overlay anywhere on this
 * page, and no `hakka-browser` (root package) import either. See
 * react-main.tsx / ReactPanel.tsx for the equivalent built from
 * `hakka-browser/react` instead.
 *
 * Four things this file owns that a floating overlay handles for you:
 *
 *  1. Capture. `createDemoStore()` (demoStore.ts) wires `hakka-core`'s own
 *     `enableFetchInterceptor`/`enableXHRInterceptor` directly into a small
 *     hand-rolled store, and that ONE store object is injected into every
 *     element below via the `store` property — see demoStore.ts's doc
 *     comment for why this is the correct approach here, not
 *     `hakka-browser`'s `start()` + shared singleton.
 *  2. Injection timing. `<hakka-request-list>` and `<hakka-stats>` build
 *     their view-model from `props.store` exactly once, the first time it's
 *     read (an `ownVm ??= createXViewModel({ store: props.store ?? ... })`
 *     memo in both element files) — set AFTER the element has already
 *     connected to the DOM, the assignment is silently too late. Both are
 *     therefore built with `document.createElement()` and get `.store` set
 *     BEFORE they're inserted, mirroring
 *     `e2e/fixtures/components-standalone.html`'s identical ordering.
 *     `<hakka-filter-bar>`'s `store` (host-suggestion ranking only) and
 *     `<hakka-request-detail>`'s `request`/`<hakka-waterfall>`'s `group` are
 *     all read reactively on every change, so those three stay plain static
 *     tags with properties set after the fact.
 *  3. Cross-element wiring `<hakka-inspector>` does internally.
 *     `<hakka-request-list>`'s `hakka:select` event is the only signal a
 *     selection happened; this file forwards it to `<hakka-request-detail>`
 *     (`.request` property — this store has no `request-id` shared-singleton
 *     resolution to hook into, see demoStore.ts), `<hakka-waterfall>`
 *     (`selectedId`), and the raw-payload panel (`<hakka-json-tree>`).
 *  4. Keeping `<hakka-waterfall>` fed. It's a pure props-in renderer with no
 *     store subscription of its own — this polls `store.getSnapshot()` and
 *     regroups with `hakka-core`'s own `groupRequests`, the same function
 *     the docs' E2E-report recipe uses.
 */
import { registerAll } from 'hakka-browser/elements'
import { groupRequests } from 'hakka-core'
import type { NetworkRequest, RequestGroup } from 'hakka-core'

import {
  chargePayment,
  createOrder,
  fetchOneUser,
  fetchSummary,
  fetchUsers,
  loadDashboardBurst,
  pingLegacy,
} from './api'
import { createDemoStore } from './demoStore'
import { applyTheme, THEME_LABELS, THEME_NAMES } from './theme'
import type { ThemeName } from './theme'

registerAll()

const store = createDemoStore()

interface RequestListEl extends HTMLElement {
  compact: boolean
  store: unknown
}
interface StatsEl extends HTMLElement {
  store: unknown
}
interface FilterBarEl extends HTMLElement {
  store: unknown
}
interface RequestDetailEl extends HTMLElement {
  request: NetworkRequest | null
}
interface WaterfallEl extends HTMLElement {
  group: RequestGroup | null
  selectedId: string | null
}
interface JsonTreeEl extends HTMLElement {
  text: string | null
}

// ── Request list + stats: build off-DOM, set `.store`, THEN insert ────────
const requestList = document.createElement('hakka-request-list') as RequestListEl
requestList.compact = true
requestList.store = store
document.getElementById('request-list-slot')!.replaceWith(requestList)
requestList.id = 'request-list'

const statsEl = document.createElement('hakka-stats') as StatsEl
statsEl.store = store
document.getElementById('stats-slot')!.replaceWith(statsEl)
statsEl.id = 'stats'

// ── Filter bar: static tag, `.store` read reactively — order doesn't matter ─
const filterBar = document.getElementById('filter-bar') as FilterBarEl
filterBar.store = store

const requestDetail = document.getElementById('request-detail') as RequestDetailEl
const waterfall = document.getElementById('waterfall') as WaterfallEl
const waterfallEmpty = document.getElementById('waterfall-empty')!
const jsonTree = document.getElementById('json-tree') as JsonTreeEl
const jsonTreeWrap = document.getElementById('json-tree-wrap')!
const payloadHint = document.getElementById('payload-hint')!
const statusLine = document.getElementById('status-line')!

let selectedId: string | null = null

function showPayload(req: NetworkRequest): void {
  if (!req.responseBody) {
    jsonTreeWrap.style.display = 'none'
    payloadHint.style.display = ''
    payloadHint.textContent = 'No JSON response body for this request.'
    return
  }
  jsonTree.text = req.responseBody
  jsonTreeWrap.style.display = ''
  payloadHint.style.display = 'none'
}

requestList.addEventListener('hakka:select', (e) => {
  const { id } = (e as CustomEvent<{ id: string }>).detail
  const req = store.getById(id)
  selectedId = id
  requestDetail.request = req ?? null
  waterfall.selectedId = id
  if (req) showPayload(req)
})

// `<hakka-request-detail>`'s back row (narrow layouts) fires this instead of
// taking a callback prop — clear the selection everywhere it's mirrored.
requestDetail.addEventListener('hakka:back', () => {
  selectedId = null
  requestDetail.request = null
  waterfall.selectedId = null
  jsonTreeWrap.style.display = 'none'
  payloadHint.style.display = ''
  payloadHint.textContent = 'Select a request to see its raw response body.'
})

// ── Waterfall: poll the store and lay it out as one shared timeline ───────
async function refreshWaterfall(): Promise<void> {
  const logs = await store.getSnapshot()
  if (logs.length === 0) return
  const [group] = groupRequests(logs, 'host')
  waterfall.group = group
  waterfall.selectedId = selectedId
  waterfallEmpty.style.display = 'none'
  waterfall.style.display = ''
}
void refreshWaterfall()
setInterval(() => void refreshWaterfall(), 1000)

// ── Tabs ─────────────────────────────────────────────────────────────────
const tabs = {
  detail: {
    btn: document.getElementById('tab-detail') as HTMLButtonElement,
    panel: document.getElementById('panel-detail')!,
  },
  waterfall: {
    btn: document.getElementById('tab-waterfall') as HTMLButtonElement,
    panel: document.getElementById('panel-waterfall')!,
  },
} as const

function selectTab(name: keyof typeof tabs): void {
  for (const [key, { btn, panel }] of Object.entries(tabs)) {
    const active = key === name
    btn.setAttribute('aria-selected', String(active))
    panel.dataset.active = String(active)
  }
}
tabs.detail.btn.addEventListener('click', () => selectTab('detail'))
tabs.waterfall.btn.addEventListener('click', () => selectTab('waterfall'))

// ── Traffic buttons ─────────────────────────────────────────────────────
function wireButton(id: string, action: () => Promise<string>): void {
  const btn = document.getElementById(id) as HTMLButtonElement
  btn.addEventListener('click', () => {
    btn.disabled = true
    action()
      .then((summary) => {
        statusLine.textContent = summary
      })
      .catch((e: unknown) => {
        statusLine.textContent = e instanceof Error ? e.message : String(e)
      })
      .finally(() => {
        btn.disabled = false
      })
  })
}
wireButton('btn-users', fetchUsers)
wireButton('btn-user', fetchOneUser)
wireButton('btn-order', createOrder)
wireButton('btn-summary', fetchSummary)
wireButton('btn-charge', chargePayment)
wireButton('btn-xhr', pingLegacy)
wireButton('btn-burst', loadDashboardBurst)

// ── Theme picker (ADR 0003 (d), standalone-elements variant — theme.ts) ───
const presetSelect = document.getElementById('preset') as HTMLSelectElement
for (const name of THEME_NAMES) {
  const opt = document.createElement('option')
  opt.value = name
  opt.textContent = THEME_LABELS[name]
  presetSelect.append(opt)
}
presetSelect.value = 'navy'
presetSelect.addEventListener('change', () => applyTheme(presetSelect.value as ThemeName))

// Real traffic on load, so the panel isn't empty before you click anything.
void fetchUsers().then((s) => {
  statusLine.textContent = s
})
void fetchSummary()
