/**
 * Expo config plugin for Hakka.
 *
 * The plugin adds Hakka's Android native capture artifacts during Expo
 * prebuild. iOS dependencies are handled by React Native autolinking and
 * CocoaPods.
 *
 * @param {Record<string, unknown>} config
 * @param {Record<string, unknown>} [options]
 * @returns {Record<string, unknown>}
 */
function withHakka(config, options = {}) {
  const { withAppBuildGradle } = require('expo/config-plugins')

  if (options.android === false) {
    return config
  }

  const androidOptions = normalizeAndroidOptions(options)

  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = addHakkaAndroidDependencies(modConfig.modResults.contents, androidOptions)
    return modConfig
  })
}

const DEFAULT_ANDROID_MAVEN_VERSION = '0.0.1'

function normalizeAndroidOptions(options) {
  const android = isObject(options.android) ? options.android : {}

  return {
    version: String(options.androidMavenVersion ?? android.mavenVersion ?? DEFAULT_ANDROID_MAVEN_VERSION),
    performance: Boolean(options.androidPerformance ?? android.performance),
  }
}

function addHakkaAndroidDependencies(contents, options) {
  const dependencies = [
    ['debugImplementation', 'hakka-network'],
    ['releaseImplementation', 'hakka-network-noop'],
  ]

  if (options.performance) {
    dependencies.push(['debugImplementation', 'hakka-performance'], ['releaseImplementation', 'hakka-performance-noop'])
  }

  const missing = dependencies
    .filter(([, artifact]) => !contents.includes(`com.noodleapps.hakka:${artifact}:`))
    .map(([configuration, artifact]) => `    ${configuration}("com.noodleapps.hakka:${artifact}:${options.version}")`)

  if (missing.length === 0) {
    return contents
  }

  const insertion = ['    // Hakka native capture dependencies', ...missing].join('\n')
  const marker = 'dependencies {'
  const index = contents.indexOf(marker)

  if (index < 0) {
    return `${contents.trimEnd()}\n\ndependencies {\n${insertion}\n}\n`
  }

  const insertAt = index + marker.length
  return `${contents.slice(0, insertAt)}\n${insertion}${contents.slice(insertAt)}`
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

module.exports = withHakka
module.exports.default = withHakka
module.exports.addHakkaAndroidDependencies = addHakkaAndroidDependencies
