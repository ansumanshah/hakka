/** Serialize a tool's payload into the MCP text-content result shape. */
export function textResult(
  payload: unknown,
  isError = false,
): {
  content: { type: 'text'; text: string }[]
  isError?: boolean
} {
  const result: { content: { type: 'text'; text: string }[]; isError?: boolean } = {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  }
  if (isError) result.isError = true
  return result
}
