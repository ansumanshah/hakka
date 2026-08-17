/**
 * "Copy as code" generators — turn a captured NetworkRequest into a ready-to-paste
 * snippet in another tool/language. Each builder is a sibling module in this
 * folder; this file is the curated list of codegen targets.
 */
export { buildFetch } from './buildFetch'
export { buildAxios } from './buildAxios'
export { buildHttpie } from './buildHttpie'
export { buildPython } from './buildPython'

/**
 * `buildMswHandlers` turns an *array* of requests into a multi-handler module
 * (not one request into one snippet), so it's implemented in `interop/msw.ts`
 * next to its round-trip counterpart `parseMswHandlers` — this just re-exports
 * it here so it's visible alongside the other codegen targets.
 */
export { buildMswHandlers } from '../interop/msw'
export type { BuildMswHandlersOptions } from '../interop/msw'

/** `toPlaywrightRoutes` is `buildMswHandlers`'s sibling for Playwright mocking, same shape and same reason it lives in `interop/playwright.ts` and is re-exported here. */
export { toPlaywrightRoutes } from '../interop/playwright'
export type { ToPlaywrightRoutesOptions } from '../interop/playwright'
