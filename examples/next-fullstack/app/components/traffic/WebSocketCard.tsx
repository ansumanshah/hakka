'use client'

import { DemoCard } from './DemoCard'
import { RunStatus } from './RunStatus'
import { useTimedRun } from './useTimedRun'

const ECHO_URL = 'wss://ws.postman-echo.com/raw'

/**
 * Opens a real WebSocket, sends one frame, and closes on the echo. The
 * browser's own WebSocket capture (hakka-core's enableWebSocketInterceptor,
 * wired by hakka-browser's start()) tags this `source: 'websocket'`, so the
 * inspector's frame list has something real to show. Postman's public echo
 * server just sends back whatever it receives.
 */
export function WebSocketCard() {
  const { state, run } = useTimedRun()

  const handleClick = () =>
    run(
      () =>
        new Promise((resolve, reject) => {
          const socket = new WebSocket(ECHO_URL)
          const timeout = setTimeout(() => {
            socket.close()
            reject(new Error('timed out waiting for the echo'))
          }, 8000)
          socket.addEventListener('open', () => socket.send('hello from the hakka demo'))
          socket.addEventListener('message', (event) => {
            clearTimeout(timeout)
            socket.close()
            resolve({ ok: true, note: `echoed: ${String(event.data)}` })
          })
          socket.addEventListener('error', () => {
            clearTimeout(timeout)
            reject(new Error('websocket error'))
          })
        }),
    )

  return (
    <DemoCard
      method="WS"
      path={ECHO_URL}
      title="WebSocket echo"
      description="Opens a real WebSocket, sends one frame, and closes on the echo."
    >
      <button
        type="button"
        className="demo-btn"
        data-testid="websocket-echo"
        onClick={handleClick}
        disabled={state.phase === 'pending'}
      >
        {state.phase === 'pending' ? 'Connecting…' : 'Open WebSocket'}
      </button>
      <RunStatus state={state} />
    </DemoCard>
  )
}
