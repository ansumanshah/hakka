/**
 * Framework detection — reads package.json and probes for known config
 * files so `hakka init` can wire up the right SDK without asking.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const cwd = process.cwd()

export type Framework = 'next' | 'vite' | 'expo' | 'react-native' | 'web'

export interface Pkg {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export function readPkg(): Pkg | null {
  try {
    return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Pkg
  } catch {
    return null
  }
}

export function hasDep(pkg: Pkg | null, name: string): boolean {
  return Boolean(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name])
}

export function fileExistsAny(...names: string[]): boolean {
  return names.some((n) => existsSync(join(cwd, n)))
}

export function detectFramework(pkg: Pkg | null): Framework {
  if (hasDep(pkg, 'expo')) return 'expo'
  if (hasDep(pkg, 'next') || fileExistsAny('next.config.js', 'next.config.mjs', 'next.config.ts')) return 'next'
  if (hasDep(pkg, 'react-native')) return 'react-native'
  if (hasDep(pkg, 'vite') || fileExistsAny('vite.config.js', 'vite.config.mjs', 'vite.config.ts')) return 'vite'
  return 'web'
}
