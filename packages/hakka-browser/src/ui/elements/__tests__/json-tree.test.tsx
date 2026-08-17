import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for `<hakka-json-tree>` (elements/json-tree.tsx) — ADR 0003 (b)/(c).
 * Pure props-driven, no store/view-model, no events — `value`/`text`
 * properties and a `max-depth` attribute controlling the collapse threshold.
 */
import { setPreset } from '../../presets'
import { register, TAG } from '../json-tree'
import { flush, makeLocalStorageMock, waitForShadowContent } from '../testHarness'

const lsMock = makeLocalStorageMock()

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
  register()
})

afterEach(() => {
  document.querySelectorAll(TAG).forEach((el) => el.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('<hakka-json-tree>', () => {
  it('shows "No body" with neither value nor text set', async () => {
    const el = document.createElement(TAG)
    document.body.appendChild(el)
    await waitForShadowContent(el)

    expect(el.shadowRoot!.textContent).toContain('No body')
  })

  it('max-depth attribute changes the default-collapsed depth', async () => {
    const nested = { a: { b: { c: 'deep' } } }

    const treeText = (el: HTMLElement) => el.shadowRoot!.querySelector('.hakka-json')!.textContent!

    const byDefault = document.createElement(TAG) as HTMLElement & { value: unknown }
    byDefault.value = nested
    document.body.appendChild(byDefault)
    await waitForShadowContent(byDefault)
    expect(treeText(byDefault)).toContain('"b"')
    expect(treeText(byDefault)).not.toContain('deep')

    // max-depth=1: depth-1 nodes start collapsed, so 'b' is not rendered.
    const shallow = document.createElement(TAG) as HTMLElement & { value: unknown }
    shallow.setAttribute('max-depth', '1')
    shallow.value = nested
    document.body.appendChild(shallow)
    await waitForShadowContent(shallow)
    expect(treeText(shallow)).toContain('"a"')
    expect(treeText(shallow)).not.toContain('"b"')

    // max-depth=9: everything expanded, the deep leaf is visible.
    const deep = document.createElement(TAG) as HTMLElement & { value: unknown }
    deep.setAttribute('max-depth', '9')
    deep.value = nested
    document.body.appendChild(deep)
    await waitForShadowContent(deep)
    expect(treeText(deep)).toContain('deep')
  })

  it('an injected `value` property (object) renders as a JSON tree', async () => {
    const el = document.createElement(TAG) as HTMLElement & { value: unknown }
    el.value = { hello: 'world', n: 42 }
    document.body.appendChild(el)
    await waitForShadowContent(el)

    const tree = el.shadowRoot!.querySelector('.hakka-json')
    expect(tree).toBeTruthy()
    expect(tree!.textContent).toContain('hello')
    expect(tree!.textContent).toContain('world')
  })

  it('a `text` property (raw JSON string) renders identically to `value`', async () => {
    const el = document.createElement(TAG) as HTMLElement & { text: unknown }
    el.text = JSON.stringify({ a: 1 })
    document.body.appendChild(el)
    await waitForShadowContent(el)

    expect(el.shadowRoot!.querySelector('.hakka-json')?.textContent).toContain('"a"')
  })

  it('`value` wins when both `value` and `text` are set', async () => {
    const el = document.createElement(TAG) as HTMLElement & { value: unknown; text: unknown }
    el.text = JSON.stringify({ from: 'text' })
    el.value = { from: 'value' }
    document.body.appendChild(el)
    await waitForShadowContent(el)

    expect(el.shadowRoot!.textContent).toContain('value')
    expect(el.shadowRoot!.textContent).not.toContain('"from": "text"')
  })

  it('unmount stops the element from receiving further theme updates', async () => {
    const el = document.createElement(TAG)
    document.body.appendChild(el)
    await flush()

    setPreset('high-contrast')
    const bgAfterHc = el.style.getPropertyValue('--hakka-bg')
    expect(bgAfterHc).toBe('#000000')

    el.remove()
    await flush()

    setPreset('light')
    expect(el.style.getPropertyValue('--hakka-bg')).toBe(bgAfterHc)
  })
})
