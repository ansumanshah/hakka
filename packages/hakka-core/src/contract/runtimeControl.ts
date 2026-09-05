import { isDeviceToHostCommand, parseControlCommand, type ControlCommand } from '../engine/control'

export const RUNTIME_CONTROL_CAPABILITIES = [
  'mock.add',
  'mock.remove',
  'mock.clear',
  'breakpoint.add',
  'breakpoint.remove',
  'breakpoint.resume',
  'breakpoint.abort',
  'throttle.set',
  'request.replay',
] as const
export type RuntimeCapability = (typeof RUNTIME_CONTROL_CAPABILITIES)[number]
export type RuntimeKind = 'browser' | 'react-native' | 'ios' | 'android' | 'server' | 'edge' | 'unknown'
export interface RuntimeTarget {
  id: string
  runtime: RuntimeKind
  capabilities: RuntimeCapability[]
  acknowledged: boolean
}
export type RuntimeControlError =
  | 'unsupported_capability'
  | 'target_disconnected'
  | 'apply_failed'
  | 'legacy_unacknowledged'
  | 'target_not_found'
  | 'timeout'
  | 'target_required'
  | 'bridge_disconnected'
export interface RuntimeControlResult {
  commandId: string
  targetId: string
  status: 'applied' | 'failed'
  error?: RuntimeControlError
}
export type RuntimeControlMessage =
  | {
      type: 'runtime.hello'
      payload: {
        role: 'runtime' | 'controller'
        runtime: RuntimeKind
        capabilities: RuntimeCapability[]
        protocolVersion: 1
      }
    }
  | { type: 'runtime.welcome'; payload: { targetId: string } }
  | { type: 'runtime.targets'; payload: { targets: RuntimeTarget[] } }
  | {
      type: 'control.request'
      payload: { commandId: string; targetId: string; command: ControlCommand; timeoutMs: number }
    }
  | { type: 'control.result'; payload: RuntimeControlResult }

const kinds = new Set<string>(['browser', 'react-native', 'ios', 'android', 'server', 'edge', 'unknown'])
const capabilities = new Set<string>(RUNTIME_CONTROL_CAPABILITIES)
const errors = new Set<string>([
  'unsupported_capability',
  'target_disconnected',
  'apply_failed',
  'legacy_unacknowledged',
  'target_not_found',
  'timeout',
  'target_required',
  'bridge_disconnected',
])
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
function validCapabilities(value: unknown): value is RuntimeCapability[] {
  return (
    Array.isArray(value) &&
    value.length <= RUNTIME_CONTROL_CAPABILITIES.length &&
    value.every((item) => typeof item === 'string' && capabilities.has(item)) &&
    new Set(value).size === value.length
  )
}
function validTarget(value: unknown): value is RuntimeTarget {
  return (
    object(value) &&
    id(value.id) &&
    typeof value.runtime === 'string' &&
    kinds.has(value.runtime) &&
    validCapabilities(value.capabilities) &&
    typeof value.acknowledged === 'boolean'
  )
}

/** Additive protocol, parsed separately so legacy capture and control frames keep their original shape. */
export function parseRuntimeControlMessage(value: unknown): RuntimeControlMessage | null {
  if (!object(value) || !object(value.payload)) return null
  const payload = value.payload
  switch (value.type) {
    case 'runtime.hello':
      if (
        (payload.role !== 'runtime' && payload.role !== 'controller') ||
        payload.protocolVersion !== 1 ||
        typeof payload.runtime !== 'string' ||
        !kinds.has(payload.runtime) ||
        !validCapabilities(payload.capabilities)
      )
        return null
      break
    case 'runtime.welcome':
      if (!id(payload.targetId)) return null
      break
    case 'runtime.targets':
      if (!Array.isArray(payload.targets) || payload.targets.length > 1024 || !payload.targets.every(validTarget))
        return null
      break
    case 'control.request': {
      const command = parseControlCommand(payload.command)
      if (
        !id(payload.commandId) ||
        !id(payload.targetId) ||
        !command ||
        isDeviceToHostCommand(command) ||
        !Number.isInteger(payload.timeoutMs) ||
        (payload.timeoutMs as number) < 1 ||
        (payload.timeoutMs as number) > 30000
      )
        return null
      return {
        type: 'control.request',
        payload: {
          commandId: payload.commandId,
          targetId: payload.targetId,
          command,
          timeoutMs: payload.timeoutMs as number,
        },
      }
    }
    case 'control.result':
      if (!id(payload.commandId) || !id(payload.targetId)) return null
      if (payload.status === 'applied') {
        if (payload.error !== undefined) return null
      } else if (payload.status !== 'failed' || typeof payload.error !== 'string' || !errors.has(payload.error))
        return null
      break
    default:
      return null
  }
  return value as unknown as RuntimeControlMessage
}
