import './bootstrap'
import { Hakka as coreHakka } from 'hakka-core'

import type { HakkaConfig } from './HakkaConfig'

type NativeHakka = Omit<typeof coreHakka, 'start' | 'configure' | 'getConfig' | 'enableJsCapture'> & {
  start(config?: HakkaConfig): void
  configure(config: HakkaConfig): void
  getConfig(): HakkaConfig
}

/** The shared singleton with React Native's native-only configuration surface. */
export const Hakka: NativeHakka = coreHakka as NativeHakka
