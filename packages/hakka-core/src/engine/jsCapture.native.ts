import type { HakkaConfig, NetworkRequest } from '../model/types'

/** React Native capture is provided exclusively by the registered native adapter. */
export function startJsCapture(
  _ingest: (request: NetworkRequest) => void,
  _config: Pick<HakkaConfig, 'maxBodySize' | 'redactHeaders'>,
): Array<() => void> {
  throw new Error('[Hakka] JavaScript capture is unavailable in React Native. Use native capture.')
}
