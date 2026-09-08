import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
function parseCsv(data: string): Record<string, string>[] {
  const rows: string[][] = [[]]
  let cell = ''
  let quoted = false
  for (let index = 0; index < data.length; index++) {
    const char = data[index]!
    if (char === '"') {
      if (quoted && data[index + 1] === '"') {
        cell += '"'
        index++
      } else quoted = !quoted
    } else if (char === ',' && !quoted) {
      rows.at(-1)!.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && data[index + 1] === '\n') index++
      rows.at(-1)!.push(cell)
      rows.push([])
      cell = ''
    } else cell += char
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field')
  if (cell.length || rows.at(-1)!.length) rows.at(-1)!.push(cell)
  else rows.pop()
  const [headers, ...values] = rows
  if (!headers?.length || headers.some((header) => !header)) throw new Error('CSV requires a non-empty header row')
  return values
    .filter((row) => row.some((value) => value.length))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
}
export async function datasets(path?: string): Promise<Record<string, string>[]> {
  if (!path) return [{}]
  const data = await readFile(path, 'utf8')
  if (extname(path).toLowerCase() === '.csv') return parseCsv(data)
  const parsed: unknown = JSON.parse(data)
  if (!Array.isArray(parsed) || !parsed.every((row) => row != null && typeof row === 'object' && !Array.isArray(row)))
    throw new Error('--data must be a JSON array of objects or CSV')
  return parsed.map((row) =>
    Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, String(value)])),
  )
}
