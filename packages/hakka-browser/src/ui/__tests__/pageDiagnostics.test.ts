import { describe, expect, it } from 'vitest'

import { describeElement, getPageInfo, getPageOutline, inspectPage, inspectPageElement } from '../pageDiagnostics'

describe('page diagnostics', () => {
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
})
