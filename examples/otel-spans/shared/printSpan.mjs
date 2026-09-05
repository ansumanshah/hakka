export function section(title) {
  console.log(`\n${title}`)
  console.log('-'.repeat(title.length))
}

export function printSpan(span) {
  const kind = span.parentId === null ? 'root' : `child of ${span.parentId}`
  const extra = span.requestKind ? `  requestKind=${span.requestKind}` : ''
  console.log(`  [span] ${span.name}  (${kind}, ${span.verbosity})${extra}`)
}

let passCount = 0
let failCount = 0

/** Print a labeled PASS/FAIL line and tally it. */
export function check(label, ok, detail) {
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`  [${mark}] ${label}${detail !== undefined ? `  (${detail})` : ''}`)
  if (ok) passCount++
  else failCount++
  return ok
}

/** Prints the pass/fail tally and returns whether every check passed. */
export function summary() {
  console.log(`\n${passCount} passed, ${failCount} failed`)
  return failCount === 0
}
