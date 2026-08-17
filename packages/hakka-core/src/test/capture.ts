import type { NetworkRequest } from '../model/types'
import type { CaptureOptions, CaptureResult } from './types'

/** Returns captured network logs — wire this to `Hakka.getLogs()` or an equivalent sink. */
export type LogProvider = () => NetworkRequest[] | Promise<NetworkRequest[]>

/** Minimal subset of the Hakka engine the capture harness needs; pass a real `Hakka` instance or a compatible stub. */
export interface HakkaLike {
  getLogs(): NetworkRequest[] | Promise<NetworkRequest[]>
  clearLogs(): void
}

/** Runs `fn`, then returns every `NetworkRequest` logged during its execution. Framework-agnostic. */
export async function captureWith(
  hakka: HakkaLike,
  fn: () => void | Promise<void>,
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  hakka.clearLogs()

  await fn()

  if (options.flushMs && options.flushMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, options.flushMs))
  }

  const logs = await hakka.getLogs()
  return { requests: logs }
}

/** Same as `captureWith`, for when you already have a log snapshot and no running Hakka instance is needed. */
export async function captureFromProvider(
  provider: LogProvider,
  fn?: () => void | Promise<void>,
): Promise<CaptureResult> {
  if (fn) await fn()
  const logs = await provider()
  return { requests: logs }
}
