/**
 * numberGates — thresholds that tint the duration/size columns.
 * Two tiers per axis: past `warn` the number renders turmeric, past `hot`
 * chili. Configurable via `start({ gates })`; text color only, never a chip —
 * rows keep the plain-number grammar.
 */

export interface NumberGates {
  /** Duration (ms) at which a request's time renders in the warning tone. */
  warnMs: number
  /** Duration (ms) at which it renders in the error tone. */
  hotMs: number
  /** Response size (bytes) at which the size renders in the warning tone. */
  warnBytes: number
  /** Response size (bytes) at which it renders in the error tone. */
  hotBytes: number
}

const DEFAULTS: NumberGates = {
  warnMs: 300,
  hotMs: 1000,
  warnBytes: 25 * 1024,
  hotBytes: 100 * 1024,
}

let gates: NumberGates = { ...DEFAULTS }

/** Merge caller thresholds over the defaults; omitted keys keep defaults. */
export function setNumberGates(overrides?: Partial<NumberGates>): void {
  gates = { ...DEFAULTS, ...overrides }
}

export function getNumberGates(): NumberGates {
  return gates
}

export function durationTier(ms: number | null | undefined): '' | 'num-warn' | 'num-hot' {
  if (ms == null) return ''
  if (ms >= gates.hotMs) return 'num-hot'
  if (ms >= gates.warnMs) return 'num-warn'
  return ''
}

export function sizeTier(bytes: number | null | undefined): '' | 'num-warn' | 'num-hot' {
  if (bytes == null) return ''
  if (bytes >= gates.hotBytes) return 'num-hot'
  if (bytes >= gates.warnBytes) return 'num-warn'
  return ''
}
