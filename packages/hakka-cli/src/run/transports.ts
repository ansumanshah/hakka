export { executeGrpc } from './grpcTransport.js'
export { executeWebSocket } from './webSocketTransport.js'
export { executeSse } from './sseTransport.js'

export interface SessionSpec {
  webSocket?: { sendFrames: Array<{ data: string; isBinary: boolean }>; maxFrames: number; timeoutMs: number }
  sse?: { maxEvents: number; timeoutMs: number }
}

export interface TransportOutput {
  status: number
  headers: Headers
  body: string
}
