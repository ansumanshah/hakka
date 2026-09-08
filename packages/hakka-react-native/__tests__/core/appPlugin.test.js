const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

jest.mock(
  'expo/config-plugins',
  () => ({
    withAppBuildGradle: (config, action) => action({ ...config, modResults: { contents: config.modResults.contents } }),
  }),
  { virtual: true },
)

const withHakka = require('../../app.plugin')
const {
  normalizeAndroidOptions,
  addHakkaAndroidDependencies,
  configureHakkaDynamicFeature,
  configureHakkaSettings,
  configureHakkaManifest,
  configureHakkaGradleProperties,
  configureSplitCompat,
  dynamicFeatureGradle,
  dynamicFeatureManifest,
  syncDynamicFeature,
} = withHakka

describe('Expo config plugin', () => {
  const temporaryRoots = []
  const appBuildGradle = `plugins {
    id("com.android.application")
}

android {
    dynamicFeatures = [":payments"]
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })

  it('defaults to Play delivery and supports bundled and disabled UI modes', () => {
    expect(normalizeAndroidOptions({})).toMatchObject({ uiDelivery: 'play', performance: false })
    expect(normalizeAndroidOptions({ android: { uiDelivery: 'bundled' } }).uiDelivery).toBe('bundled')
    expect(normalizeAndroidOptions({ androidUI: false, uiDelivery: 'play' }).uiDelivery).toBe('disabled')
    expect(() => normalizeAndroidOptions({ uiDelivery: 'unknown' })).toThrow('Invalid Hakka Android uiDelivery')
  })

  it('migrates old debug/noop lines to one production capture dependency set', () => {
    const old = appBuildGradle.replace(
      'dependencies {',
      `dependencies {
    // Hakka native capture dependencies
    debugImplementation("com.noodleapps.hakka:hakka-network:0.0.1")
    releaseImplementation("com.noodleapps.hakka:hakka-network-noop:0.0.1")
    debugImplementation("com.noodleapps.hakka:hakka-performance:0.0.1")
    releaseImplementation("com.noodleapps.hakka:hakka-performance-noop:0.0.1")`,
    )
    const once = addHakkaAndroidDependencies(old, {
      version: '0.0.2',
      performance: true,
      uiDelivery: 'play',
    })
    const twice = addHakkaAndroidDependencies(once, {
      version: '0.0.2',
      performance: true,
      uiDelivery: 'play',
    })

    expect(twice).toBe(once)
    expect(once).toContain('implementation("com.noodleapps.hakka:hakka-network:0.0.2")')
    expect(once).toContain('implementation("com.noodleapps.hakka:hakka-performance:0.0.2")')
    expect(once.match(/com\.google\.android\.play:feature-delivery/g)).toHaveLength(1)
    expect(once).toContain('constraints {')
    expect(once).toContain('implementation("androidx.activity:activity:1.12.1")')
    expect(once).toContain('implementation("androidx.collection:collection:1.5.0")')
    expect(once).toContain('implementation("androidx.compose.runtime:runtime-annotation:1.10.0")')
    expect(once).toContain('implementation("androidx.core:core-ktx:1.17.0")')
    expect(once).toContain('implementation("androidx.emoji2:emoji2:1.4.0")')
    expect(once).toContain('implementation("androidx.emoji2:emoji2-views-helper:1.4.0")')
    expect(once).toContain('implementation("androidx.lifecycle:lifecycle-runtime:2.9.4")')
    expect(once).toContain('implementation("androidx.savedstate:savedstate:1.3.2")')
    expect(once).not.toContain('hakka-network-noop')
    expect(once).not.toContain('hakka-performance-noop')
    expect(once).not.toContain('hakka-ui')
  })

  it('uses bundled UI explicitly and omits UI dependencies when disabled', () => {
    const bundled = addHakkaAndroidDependencies(appBuildGradle, {
      version: '0.0.1',
      performance: false,
      uiDelivery: 'bundled',
    })
    const disabled = addHakkaAndroidDependencies(bundled, {
      version: '0.0.1',
      performance: false,
      uiDelivery: 'disabled',
    })

    expect(bundled).toContain('implementation("com.noodleapps.hakka:hakka-ui:0.0.1")')
    expect(bundled).not.toContain('feature-delivery')
    expect(disabled).not.toContain('hakka-ui')
    expect(disabled).not.toContain('feature-delivery')
    expect(disabled).not.toContain('Hakka AndroidX feature alignment')
    expect(disabled).toContain('implementation("com.noodleapps.hakka:hakka-network:0.0.1")')
  })

  it('preserves existing dynamic features and removes only its managed declaration', () => {
    const enabled = configureHakkaDynamicFeature(appBuildGradle, true)
    const enabledAgain = configureHakkaDynamicFeature(enabled, true)
    const disabled = configureHakkaDynamicFeature(enabledAgain, false)

    expect(enabledAgain).toBe(enabled)
    expect(enabled).toContain('dynamicFeatures = [":payments"]')
    expect(enabled).toContain('android.dynamicFeatures += [":hakkaInspector"]')
    expect(enabled.indexOf('android.dynamicFeatures +=')).toBeGreaterThan(enabled.indexOf('dynamicFeatures ='))
    expect(disabled).toContain('dynamicFeatures = [":payments"]')
    expect(disabled).not.toContain(':hakkaInspector')
  })

  it('keeps an app-owned feature declaration while avoiding duplicates', () => {
    const appOwned = appBuildGradle.replace('[":payments"]', '[":payments", ":hakkaInspector"]')
    expect(configureHakkaDynamicFeature(appOwned, true)).toBe(appOwned)
    expect(configureHakkaDynamicFeature(appOwned, false)).toBe(appOwned)
  })

  it('adds and removes Play settings, manifest metadata, and SplitCompat idempotently', () => {
    const settings = configureHakkaSettings("include ':app'\ninclude ':payments'\n", true)
    expect(configureHakkaSettings(settings, true)).toBe(settings)
    expect(configureHakkaSettings(settings, false)).toBe("include ':app'\ninclude ':payments'\n")

    const manifest = { application: [{ 'meta-data': [{ $: { 'android:name': 'existing' } }] }] }
    configureHakkaManifest(manifest, true)
    expect(manifest.application[0]['meta-data']).toHaveLength(2)
    configureHakkaManifest(manifest, false)
    expect(manifest.application[0]['meta-data']).toEqual([{ $: { 'android:name': 'existing' } }])

    const mainApplication = `package com.example

import android.app.Application

class MainApplication : Application() {
}
`
    const installed = configureSplitCompat(mainApplication, true)
    expect(configureSplitCompat(installed, true)).toBe(installed)
    expect(installed).toContain('override fun attachBaseContext(base: android.content.Context)')
    expect(installed).toContain('SplitCompat.install(this)')
    expect(configureSplitCompat(installed, false)).toBe(mainApplication)

    const existingOverride = `package com.example

import android.app.Application
import android.content.Context

class MainApplication : Application() {
  override fun attachBaseContext(context: Context) {
    super.attachBaseContext(context)
    initializeApp()
  }
}
`
    const augmented = configureSplitCompat(existingOverride, true)
    expect(augmented.match(/override fun attachBaseContext/g)).toHaveLength(1)
    expect(augmented.indexOf('SplitCompat.install(this)')).toBeGreaterThan(
      augmented.indexOf('super.attachBaseContext(context)'),
    )
    expect(configureSplitCompat(augmented, false)).toBe(existingOverride)

    expect(
      configureHakkaGradleProperties([
        { type: 'property', key: 'android.nonTransitiveRClass', value: 'false' },
        { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2g' },
      ]),
    ).toEqual([
      { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2g' },
      { type: 'property', key: 'android.nonTransitiveRClass', value: 'true' },
    ])
  })

  it('generates a compilable feature and protects app-owned files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hakka-plugin-'))
    temporaryRoots.push(root)
    syncDynamicFeature(root, { version: '0.0.1', uiDelivery: 'play' })
    const featureGradle = fs.readFileSync(path.join(root, 'hakkaInspector/build.gradle'), 'utf8')

    expect(featureGradle).toBe(dynamicFeatureGradle('0.0.1'))
    expect(featureGradle).toContain('compileSdk rootProject.ext.compileSdkVersion')
    expect(featureGradle).toContain('minSdk rootProject.ext.minSdkVersion')
    expect(featureGradle).toContain('META-INF/androidx.*.version')
    expect(dynamicFeatureManifest()).toContain('@android:style/Theme.DeviceDefault.Light.NoActionBar')
    expect(dynamicFeatureManifest()).toContain('@xml/hakka_inspector_file_paths')
    expect(fs.existsSync(path.join(root, 'app/src/main/res/xml/hakka_inspector_file_paths.xml'))).toBe(true)

    syncDynamicFeature(root, { version: '0.0.1', uiDelivery: 'disabled' })
    expect(fs.existsSync(path.join(root, 'hakkaInspector/build.gradle'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'app/src/main/res/xml/hakka_inspector_file_paths.xml'))).toBe(false)

    fs.mkdirSync(path.join(root, 'hakkaInspector'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'hakkaInspector/build.gradle'),
      '// app owned\n// mentions @generated by hakka-react-native\n',
    )
    expect(() => syncDynamicFeature(root, { version: '0.0.1', uiDelivery: 'play' })).toThrow(
      'Hakka will not overwrite app-owned file',
    )
  })

  it('applies the default production capture change through the plugin entrypoint', () => {
    const result = withHakka({ modResults: { contents: appBuildGradle } })
    expect(result.modResults.contents).toContain('implementation("com.noodleapps.hakka:hakka-network:0.0.1")')
    expect(result.modResults.contents).toContain('android.dynamicFeatures += [":hakkaInspector"]')
  })
})
