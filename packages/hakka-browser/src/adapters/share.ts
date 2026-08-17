import { copyToClipboard } from './clipboard'

/**
 * Share via the Web Share API on supporting (mostly mobile) browsers, falling
 * back to copying to the clipboard everywhere else. Returns true if the content
 * was shared or copied.
 */
export async function shareText(opts: { title?: string; text: string }): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ title: opts.title, text: opts.text })
      return true
    }
  } catch {
    /* user cancelled or unsupported — fall back to clipboard */
  }
  return copyToClipboard(opts.text)
}
