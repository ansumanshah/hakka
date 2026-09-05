import {
  parseRuntimeControlMessage,
  type RuntimeControlMessage,
  type RuntimeControlResult,
  type RuntimeTarget,
} from 'hakka-core'

interface Peer {
  send: (message: RuntimeControlMessage) => void
  target: RuntimeTarget
  role: 'runtime' | 'controller' | 'legacy'
  commands: Set<string>
}
interface Pending {
  owner: string
  target: string
  timer: ReturnType<typeof setTimeout>
}

/** Routes targeted control without ever falling back to legacy broadcast. */
export class RuntimeRouter {
  private readonly peers = new Map<string, Peer>()
  private readonly pending = new Map<string, Pending>()

  connect(id: string, send: Peer['send']): void {
    this.peers.set(id, {
      send,
      role: 'legacy',
      commands: new Set(),
      target: { id, runtime: 'unknown', capabilities: [], acknowledged: false },
    })
    this.publishTargets()
  }

  disconnect(id: string): void {
    this.peers.delete(id)
    for (const [commandId, pending] of this.pending) {
      if (pending.owner === id || pending.target === id) {
        this.finish({ commandId, targetId: pending.target, status: 'failed', error: 'target_disconnected' })
      }
    }
    this.publishTargets()
  }

  handle(id: string, value: unknown): boolean {
    const message = parseRuntimeControlMessage(value)
    if (!message) return false
    const peer = this.peers.get(id)
    if (!peer) return true
    if (message.type === 'runtime.hello') {
      if (peer.role !== 'legacy') return true
      peer.role = message.payload.role
      peer.target = {
        id,
        runtime: message.payload.runtime,
        capabilities: message.payload.capabilities,
        acknowledged: true,
      }
      if (peer.role === 'runtime') peer.send({ type: 'runtime.welcome', payload: { targetId: id } })
      this.publishTargets()
    } else if (message.type === 'control.request') {
      if (peer.role !== 'controller') return true
      const { commandId, targetId, command, timeoutMs } = message.payload
      // The finite connection budget prevents forgotten IDs from becoming replayable.
      if (peer.commands.has(commandId)) return true
      if (peer.commands.size >= 10000 || this.pending.has(commandId)) {
        peer.send({ type: 'control.result', payload: { commandId, targetId, status: 'failed', error: 'apply_failed' } })
        return true
      }
      peer.commands.add(commandId)
      const target = this.peers.get(targetId)
      const error =
        !target || target.role === 'controller'
          ? 'target_not_found'
          : !target.target.acknowledged
            ? 'legacy_unacknowledged'
            : !target.target.capabilities.some((capability) => capability === command.kind)
              ? 'unsupported_capability'
              : undefined
      if (error) {
        peer.send({ type: 'control.result', payload: { commandId, targetId, status: 'failed', error } })
        return true
      }
      const timer = setTimeout(
        () => this.finish({ commandId, targetId, status: 'failed', error: 'timeout' }),
        timeoutMs,
      )
      this.pending.set(commandId, { owner: id, target: targetId, timer })
      target!.send(message)
    } else if (message.type === 'control.result') {
      const pending = this.pending.get(message.payload.commandId)
      if (pending && pending.target === id && message.payload.targetId === id) this.finish(message.payload)
    }
    return true
  }

  close(): void {
    for (const pending of this.pending.values()) clearTimeout(pending.timer)
    this.pending.clear()
    this.peers.clear()
  }

  private finish(result: RuntimeControlResult): void {
    const pending = this.pending.get(result.commandId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(result.commandId)
    this.peers.get(pending.owner)?.send({ type: 'control.result', payload: result })
  }

  private publishTargets(): void {
    const targets = [...this.peers.values()].filter((peer) => peer.role !== 'controller').map((peer) => peer.target)
    for (const peer of this.peers.values()) {
      if (peer.role === 'controller') peer.send({ type: 'runtime.targets', payload: { targets } })
    }
  }
}
