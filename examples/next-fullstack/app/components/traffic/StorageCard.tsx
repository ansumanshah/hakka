'use client'

import { DemoCard } from './DemoCard'
import { RunStatus } from './RunStatus'
import { useTimedRun } from './useTimedRun'

/**
 * Writes to localStorage, sessionStorage, and document.cookie directly — no
 * network call. The Storage tab reads all three live from the browser
 * (hakka-browser's readStorage adapter), so nothing needs to be captured
 * first: open it after this and Local, Session, and Cookies are already
 * populated.
 */
export function StorageCard() {
  const { state, run } = useTimedRun()

  const handleClick = () =>
    run(async () => {
      localStorage.setItem('demo-user', JSON.stringify({ name: 'demo user', plan: 'free' }))
      sessionStorage.setItem('demo-visit-at', new Date().toISOString())
      document.cookie = 'demo_pref=dark-mode; Path=/'
      return { ok: true, note: 'wrote localStorage, sessionStorage, and a cookie' }
    })

  return (
    <DemoCard
      method="STORAGE"
      path="localStorage / sessionStorage / cookie"
      title="Write to storage"
      description="No network call. Open the Storage tab and check Local, Session, and Cookies."
    >
      <button
        type="button"
        className="demo-btn"
        data-testid="write-storage"
        onClick={handleClick}
        disabled={state.phase === 'pending'}
      >
        {state.phase === 'pending' ? 'Writing…' : 'Write to storage'}
      </button>
      <RunStatus state={state} />
    </DemoCard>
  )
}
