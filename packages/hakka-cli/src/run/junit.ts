import type { RunReport } from './types.js'
export function junit(report: RunReport): string {
  const failures = report.items.filter((item) => item.outcome !== 'passed')
  const cases = report.items
    .map(
      (item) =>
        `<testcase name="${escapeXml(item.name)}" time="${(item.durationMs / 1000).toFixed(3)}">${item.outcome === 'passed' ? '' : `<failure message="${escapeXml(item.error ?? item.assertions.join('; '))}"/>`}</testcase>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Hakka collection" tests="${report.items.length}" failures="${failures.length}" time="${(report.durationMs / 1000).toFixed(3)}">${cases}</testsuite>\n`
}
function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  )
}
