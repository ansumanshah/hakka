// RN 0.85 moved the jest preset out of the `react-native` package into
// `@react-native/jest-preset`. `preset: 'react-native'` no longer resolved, so
// `bun run test` failed at config load and this app's __tests__ never ran.
//
// KNOWN ISSUE: with the preset resolving, the run now fails later on
// `this._moduleMocker.clearMocksOnScope is not a function` — jest-runtime@30.4.2
// against a hoisted jest-mock@29.7.0/30.3.0 that predates that method. Pinning
// jest-mock via a root `overrides` entry does not dislodge it under bun's
// hoisting. The repo's real RN gate (`just test`, 278 tests in
// packages/hakka-react-native) is unaffected and passes; only this app's stock
// scaffold test is blocked.
module.exports = {
  preset: '@react-native/jest-preset',
}
