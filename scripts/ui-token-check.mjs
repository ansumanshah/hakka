#!/usr/bin/env node
/**
 * Fails when an inspector style hardcodes a geometry number instead of reaching
 * for a design token. Covers four UI surfaces:
 *
 *   Web (CSS)     packages/hakka-browser/src/ui        `height: 36px;`
 *   SwiftUI       ios/Sources/UI                       `.padding(16)`
 *   Android       android/hakka-ui/src/main/kotlin     `setPadding(dp(16), …)`
 *   macOS/SwiftUI apps/hakka/Sources/App               `.padding(16)`
 *
 * The inspector reached 0.1.0 with fifteen distinct control heights and six
 * different page gutters, because every screen restyled a bare `View` rather
 * than using a shared primitive. Fixing that page by page does not hold — the
 * next screen re-invents it. This is the check that makes it hold.
 *
 * Use instead:
 *   heights ....... theme.controlHeight.{badge,chip,icon,field,nav,bar}
 *   page edges .... theme.layout.{gutter,cardPadding,sectionGap,rowGap}
 *   gaps/padding .. theme.spacing.*
 *   radii ......... theme.radius.*
 *   type .......... theme.fontSize.* / theme.fontWeight.*
 *   whole controls  components/primitives.tsx, components/Chip.tsx
 *
 * Genuinely one-off geometry — a chart bar, a health rail, a switch thumb, a
 * hairline — is not a control. Mark those lines `// ui-token-check-ignore: why`.
 */
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const WEB_ROOT = join(repoRoot, 'packages/hakka-browser/src/ui')
const IOS_ROOT = join(repoRoot, 'ios/Sources/UI')
const ANDROID_ROOT = join(repoRoot, 'android/hakka-ui/src/main/kotlin/com/noodleapps/hakka/ui')
const MAC_ROOT = join(repoRoot, 'apps/hakka/Sources/App')

// Directories whose numbers are drawing instructions, not layout.
const SKIP_DIRS = new Set(['icons'])

// The token definitions themselves are where the numbers are supposed to live.
const SKIP_FILES = new Set([
  'styles/tokens.ts',
  'styles/tokens.generated.ts',
  'tokens.css',
  'ThemeTokens.generated.swift',
  'GeneratedTokens.kt',
  'ViewHelpers.kt',
  'Shared/ThemeTokens.generated.swift',
  'Helpers/Metrics.swift',
])

// Same properties, kebab-cased, terminated by `;` — matches both a CSS rule in
// styles.ts and an inline `style="..."` attribute in a .tsx.
const PROPS = [
  'padding',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingHorizontal',
  'paddingVertical',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginHorizontal',
  'marginVertical',
  'gap',
  'rowGap',
  'columnGap',
  'height',
  'minHeight',
  'borderRadius',
  'fontSize',
]

const CSS_PROPS = PROPS.map((p) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))
const CSS_VIOLATION = new RegExp(`(?:^|[;"'{\\s])(${CSS_PROPS.join('|')}):\\s*([^;"'}]+)`, 'g')

// Values a CSS declaration may legitimately hold without a token.
const CSS_OK =
  /var\(|calc\(|env\(|clamp\(|min\(|max\(|\$\{|^(0|auto|inherit|initial|unset|none|100%|fit-content|max-content|min-content)$|%$|\d(dvh|vh|vw|em|rem|ch|ex|fr)\b/

// SwiftUI geometry that decides layout: paddings, corner radii, stack spacing,
// frame dimensions, and system type sizes.
//
// Deliberately NOT matched: `lineWidth:` and a bare `size:` on an SF Symbol or
// a Shape (stroke and glyph drawing instructions), and every `width:` — a fixed
// width is content-driven column geometry (a method label's column, a timing
// column), not a control dimension. The RN checker draws the same line: heights
// make controls share a baseline, widths do not.
const SWIFT_VIOLATION =
  /\.(?:padding|cornerRadius)\(\s*(?:\.\w+,\s*)?(-?\d+(?:\.\d+)?)\s*\)|\.system\(size:\s*(-?\d+(?:\.\d+)?)|\b(?:spacing|height|minHeight|maxHeight):\s*(-?\d+(?:\.\d+)?)\b/g

// Android: spacing-bearing dp() arguments and sp text sizes.
//
// Deliberately NOT matched: a bare `dp(N)` inside `LayoutParams(...)`, which is
// usually a fixed column width — the same width carve-out the other three
// dialects make. `dp(1)` is a hairline.
const KOTLIN_PADDING = /\b(?:setPadding|setPaddingRelative|setMargins|updatePadding)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g
const KOTLIN_DP = /\bdp\((\d+)\)/g
const KOTLIN_TEXT_SIZE = /\btextSize\s*=\s*(\d+(?:\.\d+)?)f\b/g

const IGNORE = /ui-token-check-ignore(?!-next-line)/
// For values that live inside a JSX inline `style` attribute, where there is no
// room for a trailing comment — put the marker on the line above.
const IGNORE_NEXT = /ui-token-check-ignore-next-line/

const suppressed = (lines, i) => IGNORE.test(lines[i]) || (i > 0 && IGNORE_NEXT.test(lines[i - 1]))

// `0` and `1` are not magic numbers — they are "none" and "a hairline".
const ALLOWED_VALUES = new Set(['0', '1'])
// `1px` is a hairline; `0` in any unit is nothing.
const CSS_ALLOWED = /^(0(px)?|1px)$/

// The `\$\{` branch of CSS_OK exempts template interpolations wholesale — the
// blind spot that let `margin-left: ${depth * 12}px` ship a hardcoded indent
// step. An interpolation stays exempt only while its expression carries no
// multi-digit numeric literal; `${depth * theme.indentStep}px` passes,
// `${depth * 12}px` does not. Single digits stay allowed (multipliers,
// hairlines); genuine exceptions take `// ui-token-check-ignore: why`.
// (No closing-brace requirement: CSS_VIOLATION's value capture stops at the
// first `}`, so the interpolation arrives truncated.)
const INTERPOLATED_MAGIC = /\$\{[^}]*\b\d{2,}(?:\.\d+)?\b/

// Split a shorthand value into its space-separated parts, but treat any
// parenthesized expression as one atomic part — `calc(var(--x) - 2px)` has an
// internal space around its `-` operator that is NOT a shorthand separator.
// A naive `.split(/\s+/)` would slice that calc() apart and false-positive on
// its interior fragments.
function splitShorthand(value) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (/\s/.test(ch) && depth <= 0) {
      if (current) parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) parts.push(current)
  return parts
}

async function* walk(dir, exts) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      yield* walk(join(dir, entry.name), exts)
    } else if (exts.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield join(dir, entry.name)
    }
  }
}

const violations = []

for await (const file of walk(WEB_ROOT, /\.(tsx?|css)$/)) {
  if (SKIP_FILES.has(relative(WEB_ROOT, file))) continue
  const cssLines = readFileSync(file, 'utf8').split('\n')
  cssLines.forEach((line, i) => {
    if (suppressed(cssLines, i)) return
    for (const match of line.matchAll(CSS_VIOLATION)) {
      const value = match[2].trim()
      if (!value) continue
      const parts = splitShorthand(value)
      // A single token may short-circuit on the whole-value check below. A
      // multi-part shorthand must NOT — `"6px var(--hakka-space-lg)"` reads
      // as "contains var(" against the whole string even though its first
      // part is a bare, un-tokened literal, so every part gets checked on
      // its own instead.
      if (parts.length === 1) {
        if (CSS_OK.test(value) || CSS_ALLOWED.test(value)) {
          // CSS_OK's `${` branch is only a pass while the interpolation itself
          // is numeral-free — see INTERPOLATED_MAGIC.
          if (INTERPOLATED_MAGIC.test(value)) {
            violations.push({ file: relative(repoRoot, file), line: i + 1, text: `${match[1]}: ${value}` })
          }
          continue
        }
        violations.push({ file: relative(repoRoot, file), line: i + 1, text: `${match[1]}: ${value}` })
        continue
      }
      // A shorthand is fine as long as every part of it is a token or a
      // zero, and no part hides an interpolated magic number.
      const badPart = parts.some((part) => !(CSS_OK.test(part) || CSS_ALLOWED.test(part)))
      const interpolatedMagic = parts.some((part) => INTERPOLATED_MAGIC.test(part))
      if (badPart || interpolatedMagic) {
        violations.push({ file: relative(repoRoot, file), line: i + 1, text: `${match[1]}: ${value}` })
      }
    }
  })
}

for await (const file of walk(IOS_ROOT, /\.swift$/)) {
  if (SKIP_FILES.has(relative(IOS_ROOT, file))) continue
  const swiftLines = readFileSync(file, 'utf8').split('\n')
  swiftLines.forEach((line, i) => {
    if (suppressed(swiftLines, i)) return
    for (const match of line.matchAll(SWIFT_VIOLATION)) {
      const value = match[1] ?? match[2] ?? match[3]
      if (ALLOWED_VALUES.has(value)) continue
      violations.push({ file: relative(repoRoot, file), line: i + 1, text: match[0].trim() })
    }
  })
}

for await (const file of walk(MAC_ROOT, /\.swift$/)) {
  if (SKIP_FILES.has(relative(MAC_ROOT, file))) continue
  const macLines = readFileSync(file, 'utf8').split('\n')
  macLines.forEach((line, i) => {
    if (suppressed(macLines, i)) return
    for (const match of line.matchAll(SWIFT_VIOLATION)) {
      const value = match[1] ?? match[2] ?? match[3]
      if (ALLOWED_VALUES.has(value)) continue
      violations.push({ file: relative(repoRoot, file), line: i + 1, text: match[0].trim() })
    }
  })
}

for await (const file of walk(ANDROID_ROOT, /\.kt$/)) {
  if (SKIP_FILES.has(relative(ANDROID_ROOT, file))) continue
  const ktLines = readFileSync(file, 'utf8').split('\n')
  ktLines.forEach((line, i) => {
    if (suppressed(ktLines, i)) return
    for (const call of line.matchAll(KOTLIN_PADDING)) {
      for (const arg of call[1].matchAll(KOTLIN_DP)) {
        if (ALLOWED_VALUES.has(arg[1])) continue
        violations.push({ file: relative(repoRoot, file), line: i + 1, text: `${call[0].trim()}` })
      }
    }
    for (const size of line.matchAll(KOTLIN_TEXT_SIZE)) {
      violations.push({ file: relative(repoRoot, file), line: i + 1, text: size[0].trim() })
    }
  })
}

if (violations.length === 0) {
  console.log('ui-token-check: no hardcoded geometry in the web, iOS, macOS, or Android inspector styles')
  process.exit(0)
}

console.error(`ui-token-check: ${violations.length} hardcoded value(s) — use a design token or a shared primitive.\n`)
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`)
}
console.error(
  '\nHeights -> theme.controlHeight.*  |  page edges -> theme.layout.*  |  gaps -> theme.spacing.*' +
    '\nradii -> theme.radius.*  |  type -> theme.fontSize.*  |  whole controls -> components/primitives.tsx' +
    '\nOne-off drawing geometry (chart bars, rails, thumbs): add `// ui-token-check-ignore: why` to the line.',
)
process.exit(1)
