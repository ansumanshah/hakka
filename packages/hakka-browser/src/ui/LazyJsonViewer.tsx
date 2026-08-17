import { lazy, Loading } from 'solid-js'
import type { Component } from 'solid-js'

/**
 * Code-split wrapper for the JSON tree viewer. The (heavy, recursive) viewer
 * loads as its own chunk the first time a response/GraphQL body is viewed —
 * keeping it out of the initial UI chunk. Until it arrives, the raw text shows
 * in a `<pre>`, so there is no blank flash and the body is readable immediately.
 */
const JsonViewerInner = lazy(() => import('./JsonViewer').then((m) => ({ default: m.JsonViewer })))

interface JsonViewerProps {
  text: string | null | undefined
}

export const JsonViewer: Component<JsonViewerProps> = (props) => (
  <Loading fallback={<pre class="hakka-json-fallback">{props.text}</pre>}>
    <JsonViewerInner text={props.text} />
  </Loading>
)
