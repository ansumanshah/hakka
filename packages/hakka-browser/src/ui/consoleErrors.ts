import { getConsoleEntries } from '../capture/console'

/**
 * Error-level count for the Logs tab badge. Split out of `ConsoleTab` so the
 * Inspector shell can read the count without statically importing the (lazy)
 * console panel component — keeping ConsoleTab out of the eager UI chunk.
 */
export function getErrorCount(): number {
  return getConsoleEntries().filter((e) => e.level === 'error').length
}
