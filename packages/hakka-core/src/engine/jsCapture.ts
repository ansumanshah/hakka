import { enableFetchInterceptor } from '../capture/fetch'
import { enableWebSocketInterceptor } from '../capture/websocket'
import { enableXHRInterceptor } from '../capture/xhr'
import type { HakkaConfig, RequestListener } from '../model/types'

/** Installs the JavaScript transport interceptors used by browser and server runtimes. */
export function startJsCapture(
  listener: RequestListener,
  config: Pick<HakkaConfig, 'maxBodySize' | 'redactHeaders'>,
): Array<() => void> {
  return [
    enableFetchInterceptor(listener, config.maxBodySize, config.redactHeaders),
    enableXHRInterceptor(listener, config.maxBodySize, config.redactHeaders),
    enableWebSocketInterceptor(listener),
  ]
}
