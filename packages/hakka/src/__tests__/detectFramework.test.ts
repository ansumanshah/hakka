import { describe, expect, test } from 'bun:test'

import { detectFramework, hasDep } from '../detectFramework'

describe('hasDep', () => {
  test('finds deps in either dependencies or devDependencies', () => {
    expect(hasDep({ dependencies: { next: '15' } }, 'next')).toBe(true)
    expect(hasDep({ devDependencies: { vite: '8' } }, 'vite')).toBe(true)
    expect(hasDep({ dependencies: {} }, 'next')).toBe(false)
    expect(hasDep(null, 'next')).toBe(false)
  })
})

describe('detectFramework', () => {
  test('Expo wins over react-native', () => {
    expect(detectFramework({ dependencies: { expo: '56', 'react-native': '0.79' } })).toBe('expo')
  })
  test('Next.js by dependency', () => {
    expect(detectFramework({ dependencies: { next: '15.3.0', react: '19' } })).toBe('next')
  })
  test('bare React Native', () => {
    expect(detectFramework({ dependencies: { 'react-native': '0.79' } })).toBe('react-native')
  })
  test('Vite by devDependency', () => {
    expect(detectFramework({ devDependencies: { vite: '8' } })).toBe('vite')
  })
  test('falls back to web when nothing matches', () => {
    expect(detectFramework({ dependencies: { lodash: '4' } })).toBe('web')
    expect(detectFramework(null)).toBe('web')
  })
})
