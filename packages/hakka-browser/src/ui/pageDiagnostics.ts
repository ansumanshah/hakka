/** Lightweight, page-local DOM diagnostics used by the opt-in Page panel. */

export interface PageElementSummary {
  selector: string
  tagName: string
  text: string
  attributes: Array<[string, string]>
  styles: Array<[string, string]>
}

export interface PageInfo {
  title: string
  url: string
  readyState: DocumentReadyState
  language: string
  viewport: {
    width: number
    height: number /* ui-token-check-ignore: page data, not UI geometry */
    devicePixelRatio: number
  }
}

const STYLE_PROPERTIES = [
  'display',
  'position',
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'margin',
  'padding',
]

function escapeIdentifier(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

/** Builds a short selector that is useful to paste back into page code. */
export function describeElement(element: Element): string {
  if (element.id) return `#${escapeIdentifier(element.id)}`
  const classes = [...element.classList]
    .slice(0, 2)
    .map((name) => `.${escapeIdentifier(name)}`)
    .join('')
  return `${element.tagName.toLowerCase()}${classes}`
}

export function inspectPageElement(element: Element): PageElementSummary {
  const computed = window.getComputedStyle(element)
  return {
    selector: describeElement(element),
    tagName: element.tagName.toLowerCase(),
    text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 140),
    attributes: [...element.attributes]
      .map((attribute): [string, string] => [attribute.name, attribute.value])
      .slice(0, 12),
    styles: STYLE_PROPERTIES.map((property): [string, string] => [property, computed.getPropertyValue(property)]),
  }
}

/** Inspect the first page element matching a selector without executing page code. */
export function inspectPage(selector: string): PageElementSummary | null {
  const element = document.querySelector(selector)
  return element && !element.closest('hakka-inspector') ? inspectPageElement(element) : null
}

/** A small, serializable page snapshot for local tools and agent integrations. */
export function getPageInfo(): PageInfo {
  return {
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    language: document.documentElement.lang,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight /* ui-token-check-ignore: page data, not UI geometry */,
      devicePixelRatio: window.devicePixelRatio,
    },
  }
}

/** Returns a bounded, shallow DOM outline so inspecting a busy page stays responsive. */
export function getPageOutline(root: ParentNode = document, limit = 80): Element[] {
  return [...root.querySelectorAll('body *')].filter((element) => !element.closest('hakka-inspector')).slice(0, limit)
}
