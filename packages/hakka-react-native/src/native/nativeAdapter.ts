/**
 * React Native-specific native adapter implementations for hakka-core.
 * Provides the RN platform bridge that the core engine accepts via dependency injection.
 */
import { NATIVE_MODULE_NAMES } from 'hakka-core'
import type { NativeCaptureAdapter, NativeHakkaModule, NativeMockBridge, NativeMockRulePayload } from 'hakka-core'
import { NativeEventEmitter, TurboModuleRegistry } from 'react-native'

type NativeEventEmitterModule = {
  addListener: (eventType: string) => void
  removeListeners: (count: number) => void
}

type ExtendedNativeModule = NativeHakkaModule & {
  addMockRule?: (rule: NativeMockRulePayload) => void
  removeMockRule?: (id: string) => void
  setMockRuleEnabled?: (id: string, enabled: boolean) => void
}

function getNativeHakkaModule(): NativeHakkaModule | null {
  const registry = TurboModuleRegistry as { get?: <T>(name: string) => T | null } | null
  if (!registry?.get) return null
  for (const name of NATIVE_MODULE_NAMES) {
    const module = registry.get<NativeHakkaModule>(name)
    if (module) return module
  }
  return null
}

export const rnCaptureAdapter: NativeCaptureAdapter = {
  captureMode: 'native',
  getModule(): NativeHakkaModule | null {
    return getNativeHakkaModule()
  },
  createEventEmitter(module: NativeHakkaModule) {
    const emitter = new NativeEventEmitter(module as unknown as NativeEventEmitterModule)
    return {
      addListener(event: string, cb: (payload: unknown) => void) {
        const sub = emitter.addListener(event, cb)
        return { remove: () => sub.remove() }
      },
    }
  },
  pause() {
    getNativeHakkaModule()?.pause?.()
  },
  resume() {
    getNativeHakkaModule()?.resume?.()
  },
}

export const rnMockBridge: NativeMockBridge = {
  addMockRule(rule: NativeMockRulePayload) {
    const module = getNativeHakkaModule() as ExtendedNativeModule | null
    module?.addMockRule?.(rule)
  },
  removeMockRule(id: string) {
    const module = getNativeHakkaModule() as ExtendedNativeModule | null
    module?.removeMockRule?.(id)
  },
  setMockRuleEnabled(id: string, enabled: boolean) {
    const module = getNativeHakkaModule() as ExtendedNativeModule | null
    module?.setMockRuleEnabled?.(id, enabled)
  },
}
