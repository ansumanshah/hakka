export const runtime = 'edge'

/**
 * The only route in this example that runs on the Edge runtime instead of
 * Node — makes the README's "Use the runtime filter to isolate client /
 * server / edge" claim literally true. Captured by `startEdgeCapture`
 * (`hakka-node/next`'s Edge branch, wired in `instrumentation.ts`) and
 * tagged `runtime: 'edge'`. Edge capture is fetch-only (no Node `http`
 * module on Edge), so this route's own outbound fetch below is exactly what
 * shows up in the inspector.
 */
export async function GET() {
  const res = await fetch('https://jsonplaceholder.typicode.com/todos/1', {
    headers: { accept: 'application/json' },
  })
  const todo = (await res.json()) as { id: number; title: string; completed: boolean }
  return Response.json({ runtime: 'edge', todo })
}
