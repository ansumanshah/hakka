/**
 * `hakka-node/ci` — network capture as a CI gate. See the module docs on each
 * file for the design rationale (normalization rules, fail-vs-warn policy,
 * exfiltration detection). Wire `startCiCapture` into a test suite's
 * setup/teardown, then use the `hakka ci-baseline record|check` CLI command
 * (in the `hakka` package) against the `.hakka` session it writes.
 */
export { startCiCapture, type CiCaptureHandle } from './recorder'
export {
  normalizeRequestsForBaseline,
  templatePath,
  hostOf,
  pathOf,
  shapeOfJson,
  shapeOfBody,
  DEFAULT_VOLATILE_HEADER_NAMES,
  type NormalizedEndpoint,
  type NormalizeOptions,
} from './normalize'
export { serializeBaseline, parseBaseline, BASELINE_SCHEMA_VERSION, type ParsedBaseline } from './baseline'
export { diffBaseline, formatDriftReport, type DriftFinding, type DriftKind, type DriftSeverity } from './diff'
export {
  findExfiltrationFindings,
  formatExfiltrationReport,
  type ExfiltrationFinding,
  type ExfiltrationCheckOptions,
} from './exfiltration'
