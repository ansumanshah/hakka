import type { Json, ObjectJson } from './types.js'
import { object, text, interpolate, enabled } from './values.js'
function pathValue(value: Json, path: string): Json | undefined {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let current: Json | undefined = value
  for (const part of parts) {
    if (current == null) return undefined
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part)) return undefined
      current = current[Number(part)]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = current[part]
  }
  return current
}
export function sourceValue(
  source: ObjectJson,
  status: number,
  durationMs: number,
  headers: Headers,
  body: string,
): string | undefined {
  if ('status' in source) return String(status)
  if ('durationMs' in source) return String(durationMs)
  if ('bodyText' in source) return body
  const header = object(source.header)
  if (Object.keys(header).length) return headers.get(text(header.name) ?? '') ?? undefined
  const jsonPath = text(source.jsonPath) ?? text(object(source.jsonPath)._0)
  if (jsonPath != null) {
    try {
      const value = pathValue(JSON.parse(body) as Json, jsonPath)
      return value == null ? undefined : typeof value === 'string' ? value : JSON.stringify(value)
    } catch {
      return undefined
    }
  }
  return undefined
}
export function assertionResult(
  assertion: ObjectJson,
  status: number,
  durationMs: number,
  headers: Headers,
  body: string,
  variables: Record<string, string>,
): string | undefined {
  if (!enabled(assertion)) return undefined
  const actual = sourceValue(object(assertion.target), status, durationMs, headers, body)
  const expected = interpolate(text(assertion.expected) ?? '', variables)
  const op = text(assertion.op) ?? 'equals'
  const pass =
    op === 'exists'
      ? actual != null
      : op === 'notExists'
        ? actual == null
        : op === 'equals'
          ? actual === expected
          : op === 'notEquals'
            ? actual !== expected
            : op === 'contains'
              ? actual?.includes(expected)
              : op === 'notContains'
                ? !actual?.includes(expected)
                : op === 'lessThan'
                  ? Number(actual) < Number(expected)
                  : op === 'greaterThan'
                    ? Number(actual) > Number(expected)
                    : op === 'matches'
                      ? new RegExp(expected).test(actual ?? '')
                      : false
  return pass ? undefined : `assertion ${op} failed`
}
