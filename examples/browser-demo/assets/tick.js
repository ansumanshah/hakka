// Tiny same-origin asset. Loading it via a <script src> tag from the demo page
// gives the browser's Performance Timeline a real 'script' resource entry.
// hakka-browser's Resource Timing enrichment only reads 'fetch'/'xmlhttprequest'
// initiator types (see src/capture/resourceTiming.ts), so this load itself never
// becomes a Network row. The demo's fetch/XHR buttons are what get real timing.
console.debug('[hakka-browser demo] tick.js loaded')
