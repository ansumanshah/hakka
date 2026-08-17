// Demo worker: captures its OWN network traffic via the hakka-browser/worker shim
// and posts it to the main thread, where Hakka (started with captureWorkers:true)
// ingests it. Loaded as a module worker so it can import the built ESM shim.
import { captureInWorker } from '../dist/worker.js'

captureInWorker()

// Make a request from inside the worker so the overlay shows worker-origin traffic.
setTimeout(() => {
  fetch('/?from=worker').catch(() => {})
}, 700)
