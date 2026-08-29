// Nothing in this file mentions Hakka. That's the point of the plugin
// (see vite.config.ts + README.md): `hakka-browser/vite` injects and starts
// the overlay for us, only in dev, with zero application code.

const statusEl = document.getElementById('status') as HTMLPreElement

function log(msg: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`
  statusEl.textContent = `${line}\n${statusEl.textContent}`.slice(0, 4000)
}

// One real request on load so the Network tab isn't empty before you click anything.
fetch('/data.json')
  .then((r) => r.json())
  .then((data) => log(`on-load fetch('/data.json') → ${JSON.stringify(data)}`))
  .catch((e: unknown) => log(`on-load fetch failed: ${e instanceof Error ? e.message : String(e)}`))

document.getElementById('btn-fetch')?.addEventListener('click', () => {
  fetch(`/data.json?t=${Date.now()}`)
    .then((r) => log(`fetch('/data.json') → ${r.status}`))
    .catch((e: unknown) => log(`fetch failed: ${e instanceof Error ? e.message : String(e)}`))
})

document.getElementById('btn-xhr')?.addEventListener('click', () => {
  const xhr = new XMLHttpRequest()
  xhr.addEventListener('loadend', () => log(`XHR GET /data.json?xhr=1 → ${xhr.status}`))
  xhr.open('GET', `/data.json?xhr=1&t=${Date.now()}`)
  xhr.send()
})

document.getElementById('btn-post')?.addEventListener('click', () => {
  fetch('/api/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ demo: true, at: Date.now() }),
  })
    .then((r) => log(`POST /api/echo → ${r.status} (no server route here, so this is a real 404 row)`))
    .catch((e: unknown) => log(`POST failed: ${e instanceof Error ? e.message : String(e)}`))
})

document.getElementById('btn-console')?.addEventListener('click', () => {
  console.log('[hakka-browser/vite example] console.log entry')
  console.warn('[hakka-browser/vite example] console.warn entry')
  console.error('[hakka-browser/vite example] console.error entry')
  log('Logged 3 console entries. See the overlay Logs tab.')
})
