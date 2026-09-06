/** Serialize a tool's payload into the MCP text-content result shape. */
export function textResult(
  payload: unknown,
  isError = false,
): {
  content: { type: 'text'; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
} {
  const result: {
    content: { type: 'text'; text: string }[]
    structuredContent?: Record<string, unknown>
    isError?: boolean
  } = {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  }
  if (payload != null && typeof payload === 'object' && !Array.isArray(payload)) {
    result.structuredContent = payload as Record<string, unknown>
  }
  if (isError) result.isError = true
  return result
}
