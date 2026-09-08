/** Recognized authored credentials are also removed from hook and transport diagnostics. */
export function credentialValues(value: unknown, parentKey = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => credentialValues(entry, parentKey))
  if (value === null || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const sensitiveName =
    /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|password|token|secret)$/i
  const sensitiveField = /^(authorization|password|clientSecret|accessToken|refreshToken|token|secret)$/i
  return Object.entries(record).flatMap(([key, child]) => {
    const sensitive =
      sensitiveField.test(key) ||
      (key === 'value' &&
        (parentKey === 'apiKey' || (typeof record.name === 'string' && sensitiveName.test(record.name))))
    if (sensitive && typeof child === 'string' && child && !/^{{\s*[^{}\s]+\s*}}$/.test(child)) return [child]
    return credentialValues(child, key)
  })
}
