import { FilterBar, JsonTree, RequestDetail, RequestList, Stats, Waterfall } from 'hakka-browser/react'
import { groupRequests } from 'hakka-core'
import type { NetworkRequest, RequestGroup } from 'hakka-core'
/**
 * The React equivalent of panel.ts — same layout, same demo API, same
 * capture engine, built from `hakka-browser/react`'s six wrapper components
 * instead of raw custom elements. See panel.ts's doc comment for the four
 * cross-element responsibilities a floating overlay would otherwise own;
 * this file owns the same four, as React state instead of manual DOM
 * plumbing:
 *
 *  1. Capture — `createDemoStore()` (demoStore.ts), built once at module
 *     scope and passed as the `store` prop to `<RequestList>`, `<Stats>`,
 *     and `<FilterBar>`.
 *  2. Injection timing — a non-issue here, unlike panel.ts. React's own
 *     commit pipeline sets a host component's initial properties on the
 *     freshly created DOM node BEFORE inserting it into the document
 *     (`createElementWrapper.tsx`'s doc comment), so passing `store={store}`
 *     as an ordinary JSX prop already lands before
 *     `<hakka-request-list>`/`<hakka-stats>` connect and read it for their
 *     one-time view-model construction — no off-DOM "create, then set, then
 *     insert" dance needed.
 *  3. Selection wiring — `selectedReq` state instead of manually setting
 *     properties on DOM nodes; each wrapper just reads it as a normal prop.
 *     `store.getById()` is a synchronous, direct lookup (demoStore.ts) —
 *     there's no store/worker round trip to await here, unlike
 *     `hakka-browser`'s own `getBody()`.
 *  4. Feeding `<Waterfall>` — same `store.getSnapshot()` + `groupRequests()`
 *     poll as panel.ts, driving a `waterfallGroup` state value instead of a
 *     property assignment.
 *
 * Registration is automatic — each wrapper calls the matching element's
 * `register()` synchronously in its own render (`createElementWrapper.tsx`),
 * so nothing here calls `registerAll()` the way panel.ts does.
 */
import { useEffect, useState } from 'react'

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

// One store, constructed once, shared by every wrapper below via the `store`
// prop — see demoStore.ts for why this (not `hakka-browser`'s `start()`) is
// the correct way to feed these elements real traffic.
const store = createDemoStore()

type TrafficAction = () => Promise<string>

/** One button's pending/run pair, sharing the panel's status line. */
function useTrafficAction(action: TrafficAction, setStatus: (s: string) => void): [boolean, () => void] {
  const [pending, setPending] = useState(false)
  const run = (): void => {
    setPending(true)
    action()
      .then(setStatus)
      .catch((e: unknown) => setStatus(e instanceof Error ? e.message : String(e)))
      .finally(() => setPending(false))
  }
  return [pending, run]
}

export function ReactPanel() {
  const [selectedReq, setSelectedReq] = useState<NetworkRequest | null>(null)
  const [waterfallGroup, setWaterfallGroup] = useState<RequestGroup | null>(null)
  const [activeTab, setActiveTab] = useState<'detail' | 'waterfall'>('detail')
  const [status, setStatus] = useState('')
  const [theme, setThemeValue] = useState<ThemeName>('navy')

  // Keep <Waterfall> fed — it's a pure props-in renderer with no store
  // subscription of its own (same reasoning as panel.ts's refreshWaterfall).
  useEffect(() => {
    let cancelled = false
    async function tick(): Promise<void> {
      const logs = await store.getSnapshot()
      if (cancelled || logs.length === 0) return
      const [group] = groupRequests(logs, 'host')
      setWaterfallGroup(group)
    }
    void tick()
    const id = setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // Real traffic on mount so the panel isn't empty before you click anything.
  useEffect(() => {
    void fetchUsers().then(setStatus)
    void fetchSummary()
  }, [])

  const [usersPending, runUsers] = useTrafficAction(fetchUsers, setStatus)
  const [userPending, runUser] = useTrafficAction(fetchOneUser, setStatus)
  const [orderPending, runOrder] = useTrafficAction(createOrder, setStatus)
  const [summaryPending, runSummary] = useTrafficAction(fetchSummary, setStatus)
  const [chargePending, runCharge] = useTrafficAction(chargePayment, setStatus)
  const [xhrPending, runXhr] = useTrafficAction(pingLegacy, setStatus)
  const [burstPending, runBurst] = useTrafficAction(loadDashboardBurst, setStatus)

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-title">Custom DevTools</span>
          <span className="brand-sub">built from hakka-browser/react</span>
        </div>

        <div className="traffic-buttons">
          <button disabled={usersPending} onClick={runUsers} title="GET /api/users">
            Users
          </button>
          <button disabled={userPending} onClick={runUser} title="GET /api/users/:id (mostly 200, sometimes 404)">
            User
          </button>
          <button disabled={orderPending} onClick={runOrder} title="POST /api/orders">
            Order
          </button>
          <button disabled={summaryPending} onClick={runSummary} title="GET /api/reports/summary, always slow (~900ms)">
            Summary (slow)
          </button>
          <button disabled={chargePending} onClick={runCharge} title="GET /api/payments/charge, always 500">
            Charge (fails)
          </button>
          <button disabled={xhrPending} onClick={runXhr} title="XMLHttpRequest GET /api/legacy/ping">
            XHR ping
          </button>
          <button disabled={burstPending} onClick={runBurst} title="Fires 4 calls concurrently, feeds the waterfall">
            Load dashboard
          </button>
        </div>

        <span className="brand-sub">{status}</span>

        <div className="theme-picker">
          <label htmlFor="preset">theme</label>
          <select
            id="preset"
            value={theme}
            onChange={(e) => {
              const next = e.target.value as ThemeName
              setThemeValue(next)
              applyTheme(next)
            }}
          >
            {THEME_NAMES.map((name) => (
              <option key={name} value={name}>
                {THEME_LABELS[name]}
              </option>
            ))}
          </select>
        </div>

        <nav className="mode-links">
          <a href="./index.html">vanilla</a>
          <a href="./react.html" aria-current="page">
            react
          </a>
        </nav>
      </header>

      <div className="filter-row">
        <FilterBar store={store} />
      </div>

      <div className="body-grid">
        <div className="rail">
          <div className="card">
            <div className="card-header">
              <span className="card-title">Requests</span>
            </div>
            <div className="card-body no-pad">
              <RequestList compact store={store} onSelect={({ id }) => setSelectedReq(store.getById(id) ?? null)} />
            </div>
          </div>
        </div>

        <div className="main-panel">
          <div className="tabs" role="tablist">
            <button
              className="tab-btn"
              role="tab"
              aria-selected={activeTab === 'detail'}
              onClick={() => setActiveTab('detail')}
            >
              Detail
            </button>
            <button
              className="tab-btn"
              role="tab"
              aria-selected={activeTab === 'waterfall'}
              onClick={() => setActiveTab('waterfall')}
            >
              Waterfall
            </button>
          </div>
          <div className="tab-panels">
            <div className="tab-panel" data-active={activeTab === 'detail'}>
              {/* No `store` prop on this one (ADR 0003 (b) — request-detail never
                  takes one) — `request` bypasses store resolution entirely. */}
              <RequestDetail request={selectedReq} onBack={() => setSelectedReq(null)} />
            </div>
            <div className="tab-panel" data-active={activeTab === 'waterfall'}>
              <div className="waterfall-wrap">
                {waterfallGroup && waterfallGroup.items.length > 0 ? (
                  <Waterfall group={waterfallGroup} selectedId={selectedReq?.id ?? null} />
                ) : (
                  <div className="empty-state">
                    Fire some traffic. The waterfall lays every captured request on one shared timeline.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="right-rail">
          <div className="card">
            <div className="card-header">
              <span className="card-title">Stats</span>
            </div>
            <div className="card-body no-pad">
              <Stats store={store} />
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Raw response</span>
            </div>
            {selectedReq?.responseBody ? (
              <div className="card-body no-pad">
                <JsonTree text={selectedReq.responseBody} maxDepth={4} />
              </div>
            ) : (
              <p className="payload-hint">
                {selectedReq
                  ? 'No JSON response body for this request.'
                  : 'Select a request to see its raw response body.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
