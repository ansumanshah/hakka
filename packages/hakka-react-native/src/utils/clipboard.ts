import Clipboard from '@react-native-clipboard/clipboard'

/**
 * Copy text to clipboard with fallback
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (Clipboard?.setString) {
      Clipboard.setString(text)
      return true
    }
    return false
  } catch {
    return false
  }
}
