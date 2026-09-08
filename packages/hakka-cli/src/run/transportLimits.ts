export const maximumBytes = 5 * 1024 * 1024
export const maximumMessages = 10_000

export function boundedInteger(value: number, label: string, maximum = 3_600_000): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`${label} must be an integer from 1 to ${maximum}`)
  return value
}

export function sessionSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(boundedInteger(timeoutMs, 'Session timeout'))
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}

export function decodeBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error('Invalid base64 message')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length > maximumBytes) throw new Error('Message exceeds 5 MiB limit')
  return bytes
}
