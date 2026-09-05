import { randomUUID } from 'node:crypto'

import {
  parseRuntimeControlMessage,
  type ControlCommand,
  type RuntimeControlMessage,
  type RuntimeControlResult,
  type RuntimeTarget,
} from 'hakka-core'

/** Per-connection controller state; no pending command survives a disconnect. */
export class RuntimeControlClient {
  private targets: RuntimeTarget[] = []
  private readonly pending = new Map<string, { target: string; finish: (result: RuntimeControlResult) => void }>()
  constructor(private readonly send: (message: RuntimeControlMessage) => boolean) {}

  getTargets(): RuntimeTarget[] {
    return this.targets.map((target) => ({ ...target, capabilities: [...target.capabilities] }))
  }

  receive(value: unknown): boolean {
    const message = parseRuntimeControlMessage(value)
    if (!message) return false
    if (message.type === 'runtime.targets') this.targets = message.payload.targets
    if (message.type === 'control.result') {
      const pending = this.pending.get(message.payload.commandId)
      if (pending?.target === message.payload.targetId) pending.finish(message.payload)
    }
    return true
  }

  disconnect(): void {
    this.targets = []
    for (const [commandId, pending] of this.pending)
      pending.finish({ commandId, targetId: pending.target, status: 'failed', error: 'bridge_disconnected' })
  }

  request(command: ControlCommand, targetId?: string, timeoutMs = 5000): Promise<RuntimeControlResult> {
    const commandId = randomUUID()
    const failure = (error: NonNullable<RuntimeControlResult['error']>) =>
      Promise.resolve({ commandId, targetId: targetId ?? '', status: 'failed' as const, error })
    if (!targetId && this.targets.length > 1) return failure('target_required')
    const target = targetId ? this.targets.find((entry) => entry.id === targetId) : this.targets[0]
    if (!target) return failure('target_not_found')
    targetId = target.id
    if (!target.acknowledged) return failure('legacy_unacknowledged')
    if (!target.capabilities.some((capability) => capability === command.kind)) return failure('unsupported_capability')
    return new Promise((resolve) => {
      const finish = (result: RuntimeControlResult) => {
        if (!this.pending.delete(commandId)) return
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(
        () => finish({ commandId, targetId: target.id, status: 'failed', error: 'timeout' }),
        timeoutMs + 100,
      )
      this.pending.set(commandId, { target: target.id, finish })
      if (!this.send({ type: 'control.request', payload: { commandId, targetId: target.id, command, timeoutMs } })) {
        finish({ commandId, targetId: target.id, status: 'failed', error: 'bridge_disconnected' })
      }
    })
  }
}
