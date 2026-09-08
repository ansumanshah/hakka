/** Lightweight, page-local DOM diagnostics used by the opt-in Page panel. */
import type { ControlCommand } from 'hakka-core'

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

const changes: Array<[string, () => void]> = []
let nextChange = 0
let remoteEditsEnabled = false
const FAILED = { ok: false } as const

function undoAllChanges(): void {
  let change: [string, () => void] | undefined
  while ((change = changes.pop())) {
    try {
      change[1]()
    } catch {
      // The host page may have removed or replaced the target since the edit.
    }
  }
}

/** Enables edits received through the authenticated runtime-control bridge. Disabled by default. */
export function setRemotePageEditsEnabled(enabled: boolean): void {
  if (!enabled && remoteEditsEnabled) undoAllChanges()
  remoteEditsEnabled = enabled
}

export function getRemotePageEditsEnabled(): boolean {
  return remoteEditsEnabled
}

const STYLE_PROPERTIES = 'display position color background-color font-size font-weight margin padding'.split(' ')

function escapeIdentifier(value: string): string {
  return globalThis.CSS?.escape?.(value) ?? value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

/** Builds a short selector that is useful to paste back into page code. */
export function describeElement(element: Element): string {
  if (element.id) return `#${escapeIdentifier(element.id.slice(0, 256))}`
  let classes = ''
  for (let index = 0; index < Math.min(element.classList.length, 2); index++) {
    classes += `.${escapeIdentifier(element.classList.item(index)!.slice(0, 128))}`
  }
  return `${element.localName}${classes}`
}

export function inspectPageElement(element: Element): PageElementSummary {
  const computed = window.getComputedStyle(element)
  const attributes: Array<[string, string]> = []
  for (const attribute of element.attributes) {
    attributes.push([attribute.name.slice(0, 128), attribute.value.slice(0, 1_024)])
    if (attributes.length > 11) break
  }
  return {
    selector: describeElement(element),
    tagName: element.localName,
    text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 140),
    attributes,
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
    title: document.title.slice(0, 512),
    url: location.href.slice(0, 2_048),
    readyState: document.readyState,
    language: document.documentElement.lang.slice(0, 64),
    viewport: {
      width: innerWidth,
      height: innerHeight /* ui-token-check-ignore: page data, not UI geometry */,
      devicePixelRatio,
    },
  }
}

/** Returns a bounded, shallow DOM outline so inspecting a busy page stays responsive. */
export function getPageOutline(root: ParentNode = document, limit = 80): Element[] {
  return getPageElements('body *', limit, root)
}

/** Returns bounded selector matches while excluding Hakka's own overlay. */
export function getPageElements(selector: string, limit = 20, root: ParentNode = document): Element[] {
  const boundedLimit = Math.min(100, Math.max(1, limit | 0))
  const elements: Element[] = []
  for (const element of root.querySelectorAll(selector)) {
    if (!element.closest('hakka-inspector')) elements.push(element)
    if (elements.length === boundedLimit) break
  }
  return elements
}

function selectPageElement(selector: string): Element | null {
  try {
    return getPageElements(selector, 1)[0] ?? null
  } catch {
    return null
  }
}

function isUnsafeAttribute(name: string, value: string | undefined): boolean {
  const normalized = name.trim().toLowerCase()
  if (normalized.startsWith('on') || normalized === 'srcdoc') return true
  if (!value || !/(?:action|href|^src)$/.test(normalized)) return false
  return value.trimStart().toLowerCase().startsWith('javascript:')
}

function rememberChange(undo: () => void): string {
  const id = String(++nextChange)
  changes.push([id, undo])
  if (changes.length > 100) changes.shift()
  return id
}

/** Executes a validated, explicitly opted-in page command and retains a bounded undo history. */
export function applyPageControl(command: Extract<ControlCommand, { kind: `page.${string}` }>): {
  ok: boolean
  data?: Record<string, unknown>
} {
  if (command.kind === 'page.inspect') {
    const limit = command.limit ?? 40
    let elements: Element[] = []
    try {
      elements = getPageElements(command.selector ?? 'body *', limit)
    } catch {
      // Invalid selectors inspect as an empty result rather than escaping into the host page.
    }
    return {
      ok: true,
      data: {
        page: getPageInfo(),
        elements: elements.map(inspectPageElement),
      },
    }
  }
  if (!remoteEditsEnabled) return FAILED
  if (command.kind === 'page.undo') {
    const index = changes.findIndex(([id]) => id === command.changeId)
    if (index < 0) return FAILED
    try {
      changes[index]![1]()
    } catch {
      return FAILED
    }
    changes.splice(index, 1)
    return { ok: true }
  }
  const element = selectPageElement(command.selector)
  if (!element) return FAILED
  let undo: (() => void) | undefined
  if (command.text !== undefined) {
    if (element.localName === 'script') return FAILED
    const previousChildren = document.createDocumentFragment()
    while (element.firstChild) previousChildren.append(element.firstChild)
    element.textContent = command.text
    undo = () => element.replaceChildren(previousChildren)
  } else if (command.attribute) {
    const { name, value } = command.attribute
    if (isUnsafeAttribute(name, value)) return FAILED
    const old = element.getAttribute(name)
    try {
      if (value === undefined) element.removeAttribute(name)
      else element.setAttribute(name, value)
    } catch {
      return FAILED
    }
    undo = () => {
      if (old === null) element.removeAttribute(name)
      else element.setAttribute(name, old)
    }
  } else if (command.style) {
    const { name, value } = command.style
    const style = (element as HTMLElement).style
    if (!style) return FAILED
    const old = style.getPropertyValue(name)
    const oldPriority = style.getPropertyPriority(name)
    if (value === undefined) style.removeProperty(name)
    else style.setProperty(name, value)
    undo = () => {
      if (old) style.setProperty(name, old, oldPriority)
      else style.removeProperty(name)
    }
  } else {
    return FAILED
  }
  return { ok: true, data: { changeId: rememberChange(undo) } }
}
