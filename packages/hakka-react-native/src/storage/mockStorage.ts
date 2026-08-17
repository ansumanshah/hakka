/**
 * Mock Rules Persistence
 *
 * Stores mock rules in AsyncStorage so they survive app restarts.
 * Uses lazy require to avoid mandatory AsyncStorage peer dependency.
 */

const MOCK_RULES_STORAGE_KEY = '@hakka/mock-rules'

type AsyncStorageLike = {
  setItem(key: string, value: string): Promise<void>
}

function getAsyncStorage(): AsyncStorageLike | null {
  try {
    // Support both community package and bare RN
    const mod =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage')
    return mod as AsyncStorageLike
  } catch {
    try {
      const mod = require('react-native').AsyncStorage
      if (mod) return mod as AsyncStorageLike
    } catch {
      // AsyncStorage not available
    }
  }
  return null
}

export async function saveMockRules(serialized: string): Promise<void> {
  const storage = getAsyncStorage()
  if (!storage) return
  try {
    await storage.setItem(MOCK_RULES_STORAGE_KEY, serialized)
  } catch (e) {
    if (__DEV__) console.error('[Hakka Mocks] Failed to save mock rules:', e)
  }
}
