export function section(title) {
  console.log(`\n${title}`)
  console.log('-'.repeat(title.length))
}

let passCount = 0
let failCount = 0

/** Print a labeled PASS/FAIL line and tally it: the demo's exit code below is derived from these, not asserted separately. */
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
