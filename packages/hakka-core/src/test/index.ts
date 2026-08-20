/**
 * hakka-core/test — framework-agnostic test helpers for Hakka. Separate entry
 * point from the package root (see `exports` in package.json) so these never
 * end up in a production bundle that only imports `hakka-core`.
 */

// types
export type { RequestFilter, CaptureOptions, CaptureResult } from './types'
export { HakkaAssertionError } from './HakkaAssertionError'

// capture harness
export type { HakkaLike, LogProvider } from './capture'
export { captureWith, captureFromProvider } from './capture'

// filters
export { findRequest, filterRequests, matchesFilter } from './filter'

// codegen
export type { GenerateTestFileOptions, TestFramework } from './codegen'
export { generateTestFile, createTestCodegenExporter } from './codegen'

// matchers
export {
  // log-level
  assertRequestMade,
  assertRequestNotMade,
  assertRequestCount,
  // request-level
  assertStatus,
  assertBody,
  assertBodyContains,
  assertResponseHeader,
  assertRequestHeader,
  assertRequestBody,
  assertIsError,
  assertIsSuccess,
  assertIsMocked,
} from './assertions'

// fluent builder
export { expectRequest, RequestMatcher } from './RequestMatcher'
