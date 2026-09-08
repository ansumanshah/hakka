import type { Json, ObjectJson, RequestSpec } from './types.js'
export function safeText(value: string, secrets: Iterable<string> = []): string {
  let result = value
    .replace(/((?:bearer|basic)\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:token|secret|password|api[-_ ]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
  for (const secret of secrets) if (secret.length >= 3) result = result.split(secret).join('[redacted]')
  return result
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('run cancelled', 'AbortError')
}
export function hasScripts(request: RequestSpec): boolean {
  const scripts = object(request.scripts)
  return ['preRequestLines', 'postResponseLines'].some((key) => Array.isArray(scripts[key]) && scripts[key].length)
}

export function object(value: Json | undefined): ObjectJson {
  return value != null && !Array.isArray(value) && typeof value === 'object' ? value : {}
}
export function text(value: Json | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}
export function number(value: Json | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined
}
export function enabled(value: ObjectJson): boolean {
  return value.enabled !== false
}

export function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/{{\s*([^{}\s]+)\s*}}/g, (whole, key: string) => variables[key] ?? whole)
}

export function unresolved(value: string): string[] {
  return [...value.matchAll(/{{\s*([^{}\s]+)\s*}}/g)].map((match) => match[1]!)
}
