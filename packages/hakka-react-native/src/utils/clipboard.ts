/**
 * Copy is best-effort by design: the clipboard module is an OPTIONAL peer —
 * the only hard alternative is failing the whole Metro build for apps that
 * never use copy actions. Resolution order: @react-native-clipboard/clipboard
 * (bare RN), then expo-clipboard (Expo apps usually already have it), else
 * copy reports failure and callers keep working without it.
 */

interface ClipboardShape {
  setString: (text: string) => void
}

interface ExpoClipboardShape {
  setStringAsync: (text: string) => Promise<boolean>
}

let setString: ((text: string) => void) | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-clipboard/clipboard')
  const impl = (mod.default ?? mod) as ClipboardShape
  if (typeof impl.setString === 'function') {
    setString = (text) => impl.setString(text)
  }
} catch {
  setString = null
}

if (!setString) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expo = require('expo-clipboard') as ExpoClipboardShape
    if (typeof expo.setStringAsync === 'function') {
      setString = (text) => {
        void expo.setStringAsync(text)
      }
    }
  } catch {
    // neither provider installed — copy actions report failure
  }
}

export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (!setString) return false
    setString(text)
    return true
  } catch {
    return false
  }
}
