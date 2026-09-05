import type { HakkaConfig as CoreConfig, RecordSink } from 'hakka-core'

/** React Native always captures through the native SDK. */
export interface HakkaConfig extends Omit<CoreConfig, 'mode'> {
  mode?: 'native'
  sinks?: readonly RecordSink[]
}
