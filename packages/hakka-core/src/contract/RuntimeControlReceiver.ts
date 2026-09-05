import type { ControlCommand } from '../engine/control'
import {
  parseRuntimeControlMessage,
  type RuntimeCapability,
  type RuntimeControlMessage,
  type RuntimeKind,
} from './runtimeControl'

/** Runtime-side targeted application. The connection owns one receiver and its duplicate cache. */
export class RuntimeControlReceiver {
  private closed = false
  private targetId: string | undefined
  private readonly commands = new Set<string>()
  constructor(
    private readonly runtime: RuntimeKind,
    private readonly capabilities: readonly RuntimeCapability[],
    private readonly apply: (command: ControlCommand) => boolean | Promise<boolean>,
    private readonly send: (message: RuntimeControlMessage) => void,
  ) {}

  hello(): void {
    this.send({
      type: 'runtime.hello',
      payload: { role: 'runtime', runtime: this.runtime, protocolVersion: 1, capabilities: [...this.capabilities] },
    })
  }

  close(): void {
    this.closed = true
  }

  receive(value: unknown): boolean {
    if (this.closed) return false
    const message = parseRuntimeControlMessage(value)
    if (!message) return false
    if (message.type === 'runtime.welcome') {
      if (this.targetId === undefined) this.targetId = message.payload.targetId
    } else if (message.type === 'control.request') {
      const { targetId, commandId, command } = message.payload
      if (targetId !== this.targetId || this.commands.has(commandId)) return true
      const fail = (error: 'apply_failed' | 'unsupported_capability') =>
        this.send({ type: 'control.result', payload: { commandId, targetId, status: 'failed', error } })
      if (this.commands.size >= 10000) {
        fail('apply_failed')
        return true
      }
      this.commands.add(commandId)
      if (!this.capabilities.some((capability) => capability === command.kind)) {
        fail('unsupported_capability')
        return true
      }
      Promise.resolve()
        .then(() => !this.closed && this.apply(command))
        .then((ok) => {
          if (ok) this.send({ type: 'control.result', payload: { commandId, targetId, status: 'applied' } })
          else fail('apply_failed')
        })
        .catch(() => fail('apply_failed'))
    }
    return true
  }
}
