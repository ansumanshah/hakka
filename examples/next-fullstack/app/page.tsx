import { Checklist } from './components/Checklist'
import { TrafficPanel } from './components/TrafficPanel'

/**
 * Server Component. The `fetch` below runs on the server during render — it
 * shows up in the overlay tagged `runtime: server`, before you have clicked
 * anything. That is the first thing worth noticing about this page: open the
 * inspector, and there is already a request waiting for you.
 */
export default async function Home() {
  const repo = await fetch('https://api.github.com/repos/vercel/next.js', {
    headers: { accept: 'application/json' },
    next: { revalidate: 60 },
  })
    .then((r) => r.json() as Promise<{ stargazers_count?: number }>)
    .catch(() => ({ stargazers_count: undefined }))

  return (
    <main className="demo-main">
      <header className="demo-hero">
        <p className="demo-kicker">
          <span className="demo-live-dot" aria-hidden="true" />
          Next.js full-stack example
        </p>
        <h1 className="demo-title">Hakka</h1>
        <p className="demo-tagline">
          Server and client requests in one inspector. Two one-line files, no separate process.
        </p>

        <div className="demo-snippet-row">
          <pre className="demo-snippet">
            <code>
              <span className="tok-comment">{'// instrumentation.ts'}</span>
              {'\n'}
              <span className="tok-kw">export</span>
              {' { '}
              <span className="tok-ident">register</span>
              {' } '}
              <span className="tok-kw">from</span> <span className="tok-str">{"'hakka-node/next'"}</span>
            </code>
          </pre>
          <pre className="demo-snippet">
            <code>
              <span className="tok-comment">{'// instrumentation-client.ts'}</span>
              {'\n'}
              <span className="tok-kw">import</span> <span className="tok-str">{"'hakka-node/next/client'"}</span>
            </code>
          </pre>
        </div>

        <p className="demo-stat">
          <span className="demo-mono">next.js</span> has{' '}
          <span className="demo-mono">{repo.stargazers_count?.toLocaleString() ?? 'n/a'}</span> stars on GitHub. Fetched
          right here, on the server, when this page rendered.
        </p>

        <div className="demo-stepzero">
          <span className="demo-stepzero-index">Step 0</span>
          <p>Tap the round button in the bottom-right corner. That opens the inspector.</p>
        </div>
      </header>

      <TrafficPanel />
      <Checklist />

      <footer className="demo-footer">
        <p>Hakka is dev-only. Nothing on this page ships to production.</p>
      </footer>
    </main>
  )
}
