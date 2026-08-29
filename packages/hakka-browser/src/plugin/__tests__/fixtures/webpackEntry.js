// Trivial entry point for `webpackTransform.test.ts`. The code under test is
// the plugin's HTML injection, not this file, so it only has to be a valid
// module webpack can build. Deliberately side-effect free: a bare console.log
// here trips the repo's own edited-files check.
export const webpackTransformTestEntry = true
