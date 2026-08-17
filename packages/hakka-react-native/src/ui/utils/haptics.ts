/**
 * haptics — runtime probe for `expo-haptics`.
 *
 * `expo-haptics` is an optional peer: bare RN hosts never install it, so this
 * module must never hard-`import` it (a static import would break Metro
 * resolution for non-Expo consumers). It `require()`s the module lazily,
 * once, and caches the result. `lightImpact()` is a silent no-op when the
 * module isn't installed or the call throws — haptics are a nice-to-have,
 * never worth crashing a debug tool over.
 */

interface HapticsModule {
  impactAsync: (style?: unknown) => Promise<void>
  ImpactFeedbackStyle?: { Light?: unknown }
}

let probedModule: HapticsModule | null | undefined

function probeHapticsModule(): HapticsModule | null {
  if (probedModule !== undefined) return probedModule

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-haptics')
    const resolvedModule = (mod?.default ?? mod) as HapticsModule
    probedModule = typeof resolvedModule?.impactAsync === 'function' ? resolvedModule : null
  } catch {
    // Optional dependency not installed — silent no-op host.
    probedModule = null
  }

  return probedModule
}

/**
 * Fire a light impact tick — replay/mock-create/clear actions. No-op (never
 * throws, never rejects visibly) when `expo-haptics` isn't installed.
 */
export function lightImpact(): void {
  const mod = probeHapticsModule()
  if (!mod) return

  try {
    void mod.impactAsync(mod.ImpactFeedbackStyle?.Light).catch(() => {
      // Never let a haptic failure surface to the caller.
    })
  } catch {
    // Synchronous throw from a hostile impactAsync implementation — ignore.
  }
}
