/**
 * Package-manager detection and install-command construction for `hakka init`.
 */
import { fileExistsAny } from './detectFramework'

export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm'

/** Detect the package manager from lockfiles in cwd (falls back to npm). */
export function detectPackageManager(): PackageManager {
  if (fileExistsAny('bun.lock', 'bun.lockb')) return 'bun'
  if (fileExistsAny('pnpm-lock.yaml')) return 'pnpm'
  if (fileExistsAny('yarn.lock')) return 'yarn'
  return 'npm'
}

/** Build the install command for a package manager (space-joined spec list). */
export function installCommand(pm: PackageManager, specs: string[], dev = false): string {
  switch (pm) {
    case 'bun':
      return `bun add ${dev ? '-d ' : ''}${specs.join(' ')}`
    case 'pnpm':
      return `pnpm add ${dev ? '-D ' : ''}${specs.join(' ')}`
    case 'yarn':
      return `yarn add ${dev ? '-D ' : ''}${specs.join(' ')}`
    default:
      return `npm i ${dev ? '-D ' : ''}${specs.join(' ')}`
  }
}
