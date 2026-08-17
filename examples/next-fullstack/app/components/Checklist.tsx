/**
 * "Try the inspector" — one-line steps mapped to real affordances in
 * packages/hakka-browser/src/ui (FilterBar's Runtime chips, Detail's Mock
 * this / Copy as agent context, RulesTab's Throttle and Breakpoints
 * sections, ConsoleTab's Logs). Static content, no interactivity, so this
 * stays a Server Component.
 */
const STEPS: string[] = [
  'Open the inspector. Tap the round button in the bottom-right corner.',
  "Open Filters, then Runtime. Pick Server to see only this page's outbound calls, then Client for the browser's.",
  'Run Slow request, open it, and read the timing waterfall: DNS through download, phase by phase.',
  'Open any request and tap Mock this. Run the same button again and the row shows the mock, not a real call.',
  'Open Rules, switch to Throttle, and pick Slow 3G. Run Fetch products again and watch the duration climb.',
  'Open Rules, switch to Breakpoints, and add one for /api/demo. Run any generator above and it pauses before the network.',
  'Run Emit logs, then open Logs: an info line, a warning, and an error, side by side.',
  'Open a request and tap Copy as agent context. Paste the bundle into an AI coding agent.',
]

export function Checklist() {
  return (
    <section aria-labelledby="checklist-heading" className="demo-section">
      <h2 id="checklist-heading" className="demo-section-title">
        Try the inspector
      </h2>
      <p className="demo-section-desc">Eight steps, start to finish. Each one uses something you just generated.</p>
      <ol className="demo-checklist">
        {STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  )
}
