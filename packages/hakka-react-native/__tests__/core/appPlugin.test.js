jest.mock(
  'expo/config-plugins',
  () => ({
    withAppBuildGradle: (config, action) =>
      action({
        ...config,
        modResults: {
          contents: config.modResults.contents,
        },
      }),
  }),
  { virtual: true },
)

const withHakka = require('../../app.plugin')
const { addHakkaAndroidDependencies } = withHakka

describe('Expo config plugin', () => {
  const appBuildGradle = `plugins {
    id("com.android.application")
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`

  it('adds Android network dependencies for debug and release builds', () => {
    const contents = addHakkaAndroidDependencies(appBuildGradle, {
      version: '0.0.1',
      performance: false,
    })

    expect(contents).toContain('debugImplementation("com.noodleapps.hakka:hakka-network:0.0.1")')
    expect(contents).toContain('releaseImplementation("com.noodleapps.hakka:hakka-network-noop:0.0.1")')
    expect(contents).not.toContain('hakka-performance:0.0.1')
  })

  it('adds optional performance dependencies when requested', () => {
    const contents = addHakkaAndroidDependencies(appBuildGradle, {
      version: '0.0.1',
      performance: true,
    })

    expect(contents).toContain('debugImplementation("com.noodleapps.hakka:hakka-performance:0.0.1")')
    expect(contents).toContain('releaseImplementation("com.noodleapps.hakka:hakka-performance-noop:0.0.1")')
  })

  it('does not duplicate existing Hakka dependencies', () => {
    const once = addHakkaAndroidDependencies(appBuildGradle, {
      version: '0.0.1',
      performance: false,
    })
    const twice = addHakkaAndroidDependencies(once, {
      version: '0.0.1',
      performance: false,
    })

    expect(twice).toBe(once)
  })

  it('applies the Gradle change through the Expo plugin entrypoint', () => {
    const result = withHakka({
      modResults: {
        contents: appBuildGradle,
      },
    })

    expect(result.modResults.contents).toContain('debugImplementation("com.noodleapps.hakka:hakka-network:0.0.1")')
  })
})
