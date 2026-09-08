import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyPageControl,
  describeElement,
  getPageInfo,
  getPageOutline,
  inspectPage,
  inspectPageElement,
  setRemotePageEditsEnabled,
} from '../pageDiagnostics'

describe('page diagnostics', () => {
  afterEach(() => setRemotePageEditsEnabled(false))

  it('describes a selected page element with its attributes and computed style', () => {
    const element = document.createElement('button')
    element.id = 'purchase-now'
    element.setAttribute('data-state', 'ready')
    element.textContent = 'Purchase now'
    document.body.appendChild(element)

    const inspected = inspectPageElement(element)

    expect(describeElement(element)).toBe('#purchase-now')
    expect(inspected.text).toBe('Purchase now')
    expect(inspected.attributes).toContainEqual(['data-state', 'ready'])
    expect(inspected.styles.some(([name]) => name === 'display')).toBe(true)
    element.remove()
  })

  it('excludes the inspector host from the bounded page outline', () => {
    const pageNode = document.createElement('main')
    const inspector = document.createElement('hakka-inspector')
    const inspectorChild = document.createElement('button')
    inspector.appendChild(inspectorChild)
    document.body.append(pageNode, inspector)

    const outline = getPageOutline(document, 10)

    expect(outline).toContain(pageNode)
    expect(outline).not.toContain(inspectorChild)
    pageNode.remove()
    inspector.remove()
  })

  it('returns a serializable page snapshot without executing a command', () => {
    const element = document.createElement('aside')
    element.id = 'agent-inspection-target'
    document.body.appendChild(element)

    expect(getPageInfo().viewport.width).toBeGreaterThanOrEqual(0)
    expect(inspectPage('#agent-inspection-target')?.selector).toBe('#agent-inspection-target')
    expect(inspectPage('#not-present')).toBeNull()
    element.remove()
  })

  it('requires edit opt-in and can undo an accepted DOM edit', () => {
    const element = document.createElement('p')
    element.id = 'editable-page-target'
    element.textContent = 'before'
    document.body.appendChild(element)
    setRemotePageEditsEnabled(false)
    expect(applyPageControl({ kind: 'page.edit', selector: '#editable-page-target', text: 'after' }).ok).toBe(false)
    expect(element.textContent).toBe('before')
    setRemotePageEditsEnabled(true)
    const edit = applyPageControl({ kind: 'page.edit', selector: '#editable-page-target', text: 'after' })
    expect(element.textContent).toBe('after')
    expect(applyPageControl({ kind: 'page.undo', changeId: edit.data?.changeId as string }).ok).toBe(true)
    expect(element.textContent).toBe('before')
    element.remove()
  })

  it('restores the original child nodes and their listeners when text is undone', () => {
    const element = document.createElement('button')
    element.id = 'reversible-text-target'
    const child = document.createElement('span')
    child.textContent = 'before'
    const clicked = vi.fn()
    child.addEventListener('click', clicked)
    element.append(child)
    document.body.append(element)

    setRemotePageEditsEnabled(true)
    const edit = applyPageControl({ kind: 'page.edit', selector: '#reversible-text-target', text: 'after' })
    expect(element.firstChild).not.toBe(child)
    expect(applyPageControl({ kind: 'page.undo', changeId: edit.data?.changeId as string }).ok).toBe(true)
    expect(element.firstChild).toBe(child)
    child.click()
    expect(clicked).toHaveBeenCalledOnce()
    element.remove()
  })

  it('restores edits when the session opt-in is disabled and requires opt-in for undo', () => {
    const element = document.createElement('div')
    element.id = 'opt-out-target'
    element.setAttribute('data-state', 'before')
    document.body.append(element)

    setRemotePageEditsEnabled(true)
    const edit = applyPageControl({
      kind: 'page.edit',
      selector: '#opt-out-target',
      attribute: { name: 'data-state', value: 'after' },
    })
    setRemotePageEditsEnabled(false)
    expect(element.getAttribute('data-state')).toBe('before')
    expect(applyPageControl({ kind: 'page.undo', changeId: edit.data?.changeId as string }).ok).toBe(false)
    element.remove()
  })

  it('preserves inline style priority through edit and undo', () => {
    const element = document.createElement('div')
    element.id = 'important-style-target'
    element.style.setProperty('color', 'red', 'important')
    document.body.append(element)

    setRemotePageEditsEnabled(true)
    const edit = applyPageControl({
      kind: 'page.edit',
      selector: '#important-style-target',
      style: { name: 'color', value: 'blue' },
    })
    expect(element.style.getPropertyPriority('color')).toBe('')
    applyPageControl({ kind: 'page.undo', changeId: edit.data?.changeId as string })
    expect(element.style.getPropertyValue('color')).toBe('red')
    expect(element.style.getPropertyPriority('color')).toBe('important')
    element.remove()
  })

  it('bounds remote inspection counts and serialized attribute values', () => {
    const container = document.createElement('section')
    container.id = 'bounded-inspection'
    for (let index = 0; index < 120; index++) {
      const child = document.createElement('i')
      child.setAttribute('data-long', 'x'.repeat(2_000))
      container.append(child)
    }
    document.body.append(container)

    const result = applyPageControl({ kind: 'page.inspect', selector: '#bounded-inspection > i', limit: 100 })
    const elements = result.data?.elements as ReturnType<typeof inspectPageElement>[]
    expect(elements).toHaveLength(100)
    expect(elements[0]?.attributes.find(([name]) => name === 'data-long')?.[1]).toHaveLength(1_024)
    container.remove()
  })

  it('rejects event-handler attributes, JavaScript URLs, srcdoc, and script text', () => {
    const target = document.createElement('a')
    target.id = 'safe-edit-target'
    const script = document.createElement('script')
    script.id = 'safe-script-target'
    document.body.append(target, script)
    setRemotePageEditsEnabled(true)

    for (const attribute of [
      { name: 'onclick', value: 'globalThis.unexpected = true' },
      { name: 'href', value: ' javascript:globalThis.unexpected = true' },
      { name: 'srcdoc', value: '<script>globalThis.unexpected = true</script>' },
    ]) {
      expect(applyPageControl({ kind: 'page.edit', selector: '#safe-edit-target', attribute }).ok).toBe(false)
    }
    expect(applyPageControl({ kind: 'page.edit', selector: '#safe-script-target', text: 'alert(1)' }).ok).toBe(false)
    target.remove()
    script.remove()
  })
})
