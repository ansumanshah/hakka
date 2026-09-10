import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Finds the packaged Python helpers from source and bundled CLI entry points. */
export function proxySupportPath(name: string): string {
  if (!/^[A-Za-z0-9_]+\.py$/.test(name)) throw new Error('Invalid proxy helper name.')
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [resolve(here, name), resolve(here, '../src/proxy', name), resolve(here, '../../src/proxy', name)]
  const found = candidates.find(existsSync)
  if (!found) throw new Error(`Hakka proxy helper ${name} is missing. Reinstall or rebuild hakka-cli.`)
  return found
}
