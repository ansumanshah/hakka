import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import type { ProxyMappingConfig } from './types'

const delimiters = ['@', ';', '!', '#', '%', '~']
const portableExpressionDescription =
  'must use the portable URL regular-expression subset (literals, character classes, capturing or non-capturing groups, quantifiers, anchors, and alternation; no lookaround, named groups, backreferences, inline flags, or Unicode properties).'

function mapArgument(parts: string[]): string {
  const delimiter = delimiters.find((candidate) => parts.every((part) => !part.includes(candidate)))
  if (!delimiter)
    throw new Error('Mapping values may not collectively contain every supported delimiter (@ ; ! # % ~).')
  return `${delimiter}${parts.join(delimiter)}`
}

/** Loads deliberately explicit mapping rules. Local substitutions are files, never directories or globs. */
export interface LoadedProxyConfiguration {
  mapLocal: string[]
  mapRemote: string[]
  addonConfigPath?: string
  rules: { header: number; block: number; delay: number }
}

function assertExpression(value: unknown, description: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`${description} requires a non-empty "match" string.`)
  if (!usesPortableExpressionSyntax(value)) throw new Error(`${description}.match ${portableExpressionDescription}`)
  try {
    new RegExp(value)
  } catch {
    throw new Error(`${description}.match is not a valid regular expression.`)
  }
}

/** Keeps saved expressions compatible with JavaScript, ICU, and Python `re`. */
function usesPortableExpressionSyntax(expression: string): boolean {
  let inCharacterClass = false
  let characterClassHasMember = false
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index]!
    if (character === '\\') {
      const escaped = expression[index + 1]
      if (!escaped) return true
      if (!'dDsSwWbBfnrtv\\.^$|?*+()[]{}-/'.includes(escaped)) return false
      if (inCharacterClass && escaped === 'B') return false
      if (inCharacterClass) characterClassHasMember = true
      index += 1
      continue
    }
    if (character === '[' && !inCharacterClass) {
      inCharacterClass = true
      characterClassHasMember = false
      continue
    }
    if (character === ']' && inCharacterClass) {
      if (!characterClassHasMember) return false
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) {
      if (!(character === '^' && !characterClassHasMember)) characterClassHasMember = true
      continue
    }
    if (character === '(' && expression[index + 1] === '?' && expression[index + 2] !== ':') return false
  }
  return true
}

function ruleList(value: unknown, description: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${description} must be an array.`)
  return value
}

function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0xd800 || code > 0xdfff) continue
    if (code > 0xdbff || index + 1 === value.length) return false
    const next = value.charCodeAt(index + 1)
    if (next < 0xdc00 || next > 0xdfff) return false
    index += 1
  }
  return true
}

function hasForbiddenHeaderValueCharacter(value: string): boolean {
  // HTTP field values permit horizontal tabs but reject other control bytes.
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)
}

/** Loads startup-only mappings and addon rules from one portable JSON file. */
export function loadProxyConfiguration(configPath: string | undefined): LoadedProxyConfiguration {
  if (!configPath)
    return {
      mapLocal: [],
      mapRemote: [],
      rules: { header: 0, block: 0, delay: 0 },
    }
  const base = dirname(resolve(configPath))
  let config: ProxyMappingConfig
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8')) as ProxyMappingConfig
  } catch (error) {
    throw new Error(
      `Could not read proxy mapping config ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config))
    throw new Error('Proxy mapping config must be a JSON object.')
  const mapLocal = (config.mapLocal ?? []).map((rule, index) => {
    if (
      !rule ||
      typeof rule.match !== 'string' ||
      typeof rule.file !== 'string' ||
      rule.match.length === 0 ||
      rule.file.length === 0
    ) {
      throw new Error(`mapLocal[${index}] requires non-empty "match" and "file" strings.`)
    }
    assertExpression(rule.match, `mapLocal[${index}]`)
    const file = resolve(base, rule.file)
    if (!isAbsolute(file) || !statSync(file).isFile())
      throw new Error(`mapLocal[${index}].file must resolve to an existing regular file.`)
    return mapArgument([rule.match, file])
  })
  const mapRemote = (config.mapRemote ?? []).map((rule, index) => {
    if (
      !rule ||
      typeof rule.match !== 'string' ||
      typeof rule.replace !== 'string' ||
      rule.match.length === 0 ||
      rule.replace.length === 0
    ) {
      throw new Error(`mapRemote[${index}] requires non-empty "match" and "replace" strings.`)
    }
    assertExpression(rule.match, `mapRemote[${index}]`)
    // The config intentionally uses the familiar `$1` capture syntax. mitmproxy
    // delegates replacement to Python `re.sub`, which requires `\\1` instead.
    const replacement = rule.replace.replace(/\$(\d+)/g, '\\$1')
    return mapArgument([rule.match, replacement])
  })
  const headerRules = ruleList(config.headerRules, 'headerRules') as NonNullable<ProxyMappingConfig['headerRules']>
  headerRules.forEach((rule, index) => {
    const description = `headerRules[${index}]`
    assertExpression(rule?.match, description)
    if (rule.phase !== 'request' && rule.phase !== 'response')
      throw new Error(`${description}.phase must be "request" or "response".`)
    if (rule.operation !== 'set' && rule.operation !== 'remove')
      throw new Error(`${description}.operation must be "set" or "remove".`)
    if (typeof rule.name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(rule.name))
      throw new Error(`${description}.name must be a valid HTTP header name.`)
    if (
      rule.operation === 'set' &&
      (typeof rule.value !== 'string' ||
        !hasOnlyUnicodeScalars(rule.value) ||
        hasForbiddenHeaderValueCharacter(rule.value))
    )
      throw new Error(
        `${description}.value must be a Unicode string without HTTP control characters when operation is "set".`,
      )
  })
  const blockRules = ruleList(config.blockRules, 'blockRules') as NonNullable<ProxyMappingConfig['blockRules']>
  blockRules.forEach((rule, index) => {
    const description = `blockRules[${index}]`
    assertExpression(rule?.match, description)
    if (rule.status !== undefined && (!Number.isInteger(rule.status) || rule.status < 400 || rule.status > 599))
      throw new Error(`${description}.status must be an integer between 400 and 599.`)
    if (
      rule.body !== undefined &&
      (typeof rule.body !== 'string' ||
        !hasOnlyUnicodeScalars(rule.body) ||
        Buffer.byteLength(rule.body, 'utf8') > 16 * 1024)
    )
      throw new Error(`${description}.body must be a Unicode UTF-8 string no larger than 16 KiB.`)
  })
  const delayRules = ruleList(config.delayRules, 'delayRules') as NonNullable<ProxyMappingConfig['delayRules']>
  delayRules.forEach((rule, index) => {
    const description = `delayRules[${index}]`
    assertExpression(rule?.match, description)
    if (rule.phase !== 'request' && rule.phase !== 'response')
      throw new Error(`${description}.phase must be "request" or "response".`)
    if (!Number.isInteger(rule.delayMs) || rule.delayMs < 0 || rule.delayMs > 30_000)
      throw new Error(`${description}.delayMs must be an integer between 0 and 30000.`)
  })
  return {
    mapLocal,
    mapRemote,
    addonConfigPath: resolve(configPath),
    rules: { header: headerRules.length, block: blockRules.length, delay: delayRules.length },
  }
}

/** Compatibility entrypoint for callers that only need mitmproxy mapping flags. */
export function loadProxyMappings(
  configPath: string | undefined,
): Pick<LoadedProxyConfiguration, 'mapLocal' | 'mapRemote'> {
  const { mapLocal, mapRemote } = loadProxyConfiguration(configPath)
  return { mapLocal, mapRemote }
}
