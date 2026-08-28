/**
 * "Try the inspector" — one-line steps mapped to real affordances in
 * packages/hakka-browser/src/ui (FilterBar's Runtime chips, Detail's Mock
 * this / Copy as agent context / Cookies / GraphQL tabs, RulesTab's Throttle
 * and Breakpoints sections, StatsTab, StorageTab, ConsoleTab's Logs,
 * InspectorToolbar's Export menu). Static content, no interactivity, so this
 * stays a Server Component.
 */
const STEPS: string[] = [
  'Open the inspector. Tap the round button in the bottom-right corner.',
  "Open Filters, then Runtime. Pick Server for this page's own calls, Client for the browser's, and Edge for the Edge runtime card above.",
  'Run Slow request, open it, and read the timing waterfall: DNS through download, phase by phase.',
  'Open any request and tap Mock this. Run the same button again and the row shows the mock, not a real call.',
  'Open Rules, switch to Throttle, and pick Slow 3G. Run Fetch products again and watch the duration climb.',
  'Open Rules, switch to Breakpoints, and add one for /api/demo. Run any generator above and it pauses before the network.',
  'Run Burst, then open Stats and read the rate, latency, and status-class breakdown it just generated.',
  'Run GraphQL query, open it, and check the GraphQL detail tab for the operation name and variables.',
  'Run WebSocket echo, open it, and look at the frame list: one sent, one received.',
  'Run Redacted headers, open Detail > Request, and confirm the Authorization value shows as [REDACTED], the default redaction list at work.',
  'Run Write to storage, then open the Storage tab and check Local, Session, and Cookies.',
  'Run Emit logs, then open Logs: an info line, a warning, and an error, side by side.',
  'Open a request and try Copy as — cURL, fetch, axios, HTTPie, Python, an MSW handler, a Playwright route — or tap Copy as agent context to paste the bundle into an AI coding agent.',
  "Open the toolbar's Export menu and download this session as HAR, a Postman collection, or OpenTelemetry JSON.",
]

export function Checklist() {
  return (
    <section aria-labelledby="checklist-heading" className="demo-section">
      <h2 id="checklist-heading" className="demo-section-title">
        Try the inspector
      </h2>
      <p className="demo-section-desc">
        {STEPS.length} steps, start to finish. Each one uses something you just generated.
      </p>
      <ol className="demo-checklist">
        {STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  )
}
