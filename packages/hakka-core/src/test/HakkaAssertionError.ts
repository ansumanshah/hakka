/**
 * Assertion failure thrown by matchers when an expectation is not met.
 */
export class HakkaAssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HakkaAssertionError'
  }
}
