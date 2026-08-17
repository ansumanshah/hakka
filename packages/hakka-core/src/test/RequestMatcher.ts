import type { NetworkRequest } from '../model/types'
import {
  assertBody,
  assertBodyContains,
  assertIsError,
  assertIsMocked,
  assertIsSuccess,
  assertRequestBody,
  assertRequestHeader,
  assertRequestMade,
  assertRequestNotMade,
  assertResponseHeader,
  assertStatus,
} from './assertions'
import type { RequestFilter } from './types'

/** Returns a fluent assertion chain (`RequestMatcher`) for a captured request log. */
export function expectRequest(logs: NetworkRequest[], filter: RequestFilter = {}): RequestMatcher {
  return new RequestMatcher(logs, filter)
}

export class RequestMatcher {
  private readonly logs: NetworkRequest[]
  private readonly filter: RequestFilter
  private matchedRequest: NetworkRequest | undefined

  constructor(logs: NetworkRequest[], filter: RequestFilter) {
    this.logs = logs
    this.filter = filter
  }

  private get request(): NetworkRequest {
    if (!this.matchedRequest) {
      this.matchedRequest = assertRequestMade(this.logs, this.filter)
    }
    return this.matchedRequest
  }

  /** Assert a matching request was captured; narrows the resolved request for later chained assertions. */
  toHaveBeenCalledWith(filter: RequestFilter): this {
    const merged: RequestFilter = { ...this.filter, ...filter }
    this.matchedRequest = assertRequestMade(this.logs, merged)
    return this
  }

  /** Assert that no matching request was captured. */
  notToHaveBeenCalled(): void {
    assertRequestNotMade(this.logs, this.filter)
  }

  /** Assert the matched request has the given HTTP status. */
  withStatus(expected: number): this {
    assertStatus(this.request, expected)
    return this
  }

  /** Assert the response body equals `expected`. */
  withBody(expected: string): this {
    assertBody(this.request, expected)
    return this
  }

  /** Assert the response body contains `substring`. */
  withBodyContaining(substring: string): this {
    assertBodyContains(this.request, substring)
    return this
  }

  /** Assert a response header is present (and optionally equals `value`). */
  withResponseHeader(name: string, value?: string): this {
    assertResponseHeader(this.request, name, value)
    return this
  }

  /** Assert a request header is present (and optionally equals `value`). */
  withRequestHeader(name: string, value?: string): this {
    assertRequestHeader(this.request, name, value)
    return this
  }

  /** Assert the request body equals `expected`. */
  withRequestBody(expected: string): this {
    assertRequestBody(this.request, expected)
    return this
  }

  /** Assert the request failed with an error. */
  thatFailed(): this {
    assertIsError(this.request)
    return this
  }

  /** Assert the request succeeded (no error, 2xx/3xx status). */
  thatSucceeded(): this {
    assertIsSuccess(this.request)
    return this
  }

  /** Assert the request was intercepted by MockEngine. */
  thatIsMocked(): this {
    assertIsMocked(this.request)
    return this
  }

  /** Return the matched NetworkRequest for further inspection. */
  get(): NetworkRequest {
    return this.request
  }
}
