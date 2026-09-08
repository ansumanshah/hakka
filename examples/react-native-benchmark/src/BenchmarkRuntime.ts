import { NativeModules, Platform } from 'react-native'

export type BenchmarkVariant = 'baseline' | 'hakka' | 'chucker' | 'pulse' | 'wormholy'

interface NativeRuntime {
  getConstants?(): { variant?: BenchmarkVariant; serverUrl?: string; autoRun?: boolean; showUI?: boolean }
  getCapturedCount(): Promise<number | null>
  getEnvironment(): Promise<Record<string, string | number | boolean | null>>
  writeResult(value: string): Promise<void>
}

const nativeRuntime = NativeModules.RNBenchmarkRuntime as NativeRuntime | undefined

export function getRuntime() {
  const constants =
    nativeRuntime?.getConstants?.() ??
    (nativeRuntime as
      | { variant?: BenchmarkVariant; serverUrl?: string; autoRun?: boolean; showUI?: boolean }
      | undefined)
  const fallbackVariant = constants?.variant ?? 'baseline'
  return {
    variant: fallbackVariant,
    platform: Platform.OS,
    // Android emulator reaches the host at 10.0.2.2; iOS Simulator uses loopback.
    serverUrl: constants?.serverUrl ?? (Platform.OS === 'android' ? 'http://10.0.2.2:4177' : 'http://127.0.0.1:4177'),
    autoRun: constants?.autoRun ?? false,
    showUI: constants?.showUI ?? false,
    getCapturedCount: async () => (await nativeRuntime?.getCapturedCount()) ?? null,
    getEnvironment: () => nativeRuntime?.getEnvironment() ?? Promise.resolve({ targetKind: 'unknown' }),
  }
}

export async function writeResult(value: unknown) {
  await nativeRuntime?.writeResult(JSON.stringify(value))
}
