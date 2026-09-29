import { afterEach, expect, it, vi } from 'vitest'

const register = vi.hoisted(() => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  return { pending, finish }
})
vi.mock('../register', async () => {
  await register.pending
  return {}
})

import { destroy, show } from '../index'

afterEach(() => destroy())

it('does not mount an overlay after destroy while the UI import is pending', async () => {
  const pending = show()
  destroy()
  register.finish()
  await pending
  expect(document.querySelector('hakka-inspector')).toBeNull()
})
