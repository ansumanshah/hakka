import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import type { ProxyMappingConfig } from './types'

const delimiters = ['@', ';', '!', '#', '%', '~']

function mapArgument(parts: string[]): string {
  const delimiter = delimiters.find((candidate) => parts.every((part) => !part.includes(candidate)))
  if (!delimiter)
    throw new Error('Mapping values may not collectively contain every supported delimiter (@ ; ! # % ~).')
  return `${delimiter}${parts.join(delimiter)}`
}

/** Loads deliberately explicit mapping rules. Local substitutions are files, never directories or globs. */
export function loadProxyMappings(configPath: string | undefined): { mapLocal: string[]; mapRemote: string[] } {
  if (!configPath) return { mapLocal: [], mapRemote: [] }
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
    try {
      new RegExp(rule.match)
    } catch {
      throw new Error(`mapLocal[${index}].match is not a valid regular expression.`)
    }
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
    try {
      new RegExp(rule.match)
    } catch {
      throw new Error(`mapRemote[${index}].match is not a valid regular expression.`)
    }
    // The config intentionally uses the familiar `$1` capture syntax. mitmproxy
    // delegates replacement to Python `re.sub`, which requires `\\1` instead.
    const replacement = rule.replace.replace(/\$(\d+)/g, '\\$1')
    return mapArgument([rule.match, replacement])
  })
  return { mapLocal, mapRemote }
}
