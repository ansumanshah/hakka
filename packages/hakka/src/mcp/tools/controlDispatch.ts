import { isDeviceToHostCommand, parseControlCommand } from 'hakka-core'
import type { ControlCommand } from 'hakka-core'

/** Minimal shape hakka mcp needs from a listener to send control commands — lets tests pass a fake sender. */
export interface ControlSender {
  sendControl(cmd: ControlCommand): boolean
  /** True when currently connected to the bridge hub. Used by tools (e.g. generate_mocks) that need to fail fast on a whole batch rather than discover disconnection one send at a time. */
  readonly connected: boolean
}

/**
 * Send a validated ControlCommand over the bridge. Returns `false` (caller
 * sets `isError`) when not connected, or when `cmd` is a device-to-host
 * command (e.g. `breakpoint.paused`) — this is the host-side send seam and
 * the host must never transmit a command whose whole reason to exist is
 * that a device sends it. The command is never transmitted in either case.
 */
export function dispatch(sender: ControlSender, cmd: ControlCommand): boolean {
  if (isDeviceToHostCommand(cmd)) return false
  // Round-trips through parseControlCommand so a malformed command fails the same way a wire-malformed one would, rather than being sent unchecked.
  const validated = parseControlCommand(cmd)
  if (!validated) return false
  return sender.sendControl(validated)
}
