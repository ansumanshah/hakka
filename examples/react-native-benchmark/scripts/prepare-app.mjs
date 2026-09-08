import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const benchmarkPlatform = process.env.BENCHMARK_PLATFORM
const benchmarkVariant = process.env.HAKKA_RN_BENCHMARK_VARIANT
const variantsByPlatform = {
  android: ['baseline', 'hakka', 'chucker'],
  ios: ['baseline', 'hakka', 'pulse', 'wormholy'],
}
if (!Object.hasOwn(variantsByPlatform, benchmarkPlatform)) {
  throw new Error('BENCHMARK_PLATFORM must be android or ios')
}
if (!variantsByPlatform[benchmarkPlatform].includes(benchmarkVariant)) {
  throw new Error(`Unsupported ${benchmarkPlatform} benchmark variant: ${String(benchmarkVariant)}`)
}
const templateDir = resolve(process.env.HAKKA_RN_BENCHMARK_HOST ?? '')
const outputDir = resolve(process.env.HAKKA_RN_BENCHMARK_OUTPUT ?? resolve(fixtureDir, '.generated'))
const workspaceRoot = resolve(process.env.HAKKA_RN_BENCHMARK_WORKSPACE ?? resolve(fixtureDir, '../..'))

if (!process.env.HAKKA_RN_BENCHMARK_HOST || !existsSync(templateDir)) {
  throw new Error('Set HAKKA_RN_BENCHMARK_HOST to a host installed by scripts/install-host.mjs')
}
const hostPackage = JSON.parse(readFileSync(resolve(templateDir, 'package.json'), 'utf8'))
if (hostPackage.dependencies?.['react-native'] !== '0.87.1' || hostPackage.dependencies?.react !== '19.2.3') {
  throw new Error('Benchmark host must use react-native 0.87.1 and react 19.2.3')
}
if (!existsSync(resolve(templateDir, 'node_modules/react-native/package.json'))) {
  throw new Error(`Benchmark host dependencies are not installed: ${templateDir}`)
}
const outputMarker = resolve(outputDir, '.hakka-rn-benchmark-generated')
for (const protectedPath of [fixtureDir, templateDir, workspaceRoot]) {
  const pathFromOutput = relative(outputDir, protectedPath)
  if (
    pathFromOutput === '' ||
    (pathFromOutput !== '..' && !pathFromOutput.startsWith('../') && !isAbsolute(pathFromOutput))
  ) {
    throw new Error(`Refusing unsafe benchmark output path: ${outputDir}`)
  }
}
if (existsSync(outputDir) && !existsSync(outputMarker)) {
  throw new Error(`Refusing to replace unowned output directory: ${outputDir}`)
}
rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })
writeFileSync(outputMarker, 'Owned by examples/react-native-benchmark/scripts/prepare-app.mjs\n')
cpSync(templateDir, outputDir, {
  recursive: true,
  filter(source) {
    return (
      !source.includes('/build/') &&
      !source.includes('/.gradle/') &&
      !source.includes('/Pods/') &&
      !source.endsWith('/node_modules') &&
      !source.includes('/node_modules/')
    )
  },
})
const templateNodeModules = resolve(templateDir, 'node_modules')
symlinkSync(templateNodeModules, resolve(outputDir, 'node_modules'), 'dir')
const templateLocalProperties = resolve(templateDir, 'android/local.properties')
if (existsSync(templateLocalProperties)) cpSync(templateLocalProperties, resolve(outputDir, 'android/local.properties'))
cpSync(resolve(fixtureDir, 'App.tsx'), resolve(outputDir, 'App.tsx'))
cpSync(resolve(fixtureDir, 'src'), resolve(outputDir, 'src'), { recursive: true })
cpSync(resolve(fixtureDir, 'package.json'), resolve(outputDir, 'package.json'))
const appManifestPath = resolve(outputDir, 'android/app/src/main/AndroidManifest.xml')
writeFileSync(
  appManifestPath,
  readFileSync(appManifestPath, 'utf8').replace(
    'android:usesCleartextTraffic="${usesCleartextTraffic}"',
    'android:usesCleartextTraffic="true"',
  ),
)
const includeHakka = benchmarkVariant === 'hakka'
if (includeHakka) {
  writeFileSync(
    resolve(outputDir, 'src/InspectorCapture.ts'),
    `import { Hakka } from 'hakka-react-native'

interface CapturedResponse {
  url: string
  responseBody?: string | null
  responseBodySize?: number
}

export function startHakkaCapture(maxRequests: number) {
  Hakka.clearLogs()
  Hakka.start({ maxRequests })
}

export function getHakkaCaptures(): CapturedResponse[] {
  return Hakka.getLogs()
}

export async function showHakkaInspector() {
  await Hakka.show()
}
`,
  )
  writeFileSync(
    resolve(outputDir, 'src/hakka-react-native.d.ts'),
    `declare module 'hakka-react-native' {
  export const Hakka: {
    clearLogs(): void
    start(config: { maxRequests: number }): void
    getLogs(): Array<{ url: string; responseBody?: string | null; responseBodySize?: number }>
    show(): Promise<boolean>
  }
}
`,
  )
}
const metroPath = resolve(outputDir, 'metro.config.js')
writeFileSync(
  metroPath,
  `const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const path = require('node:path')

const workspaceRoot = ${JSON.stringify(workspaceRoot)}
const hostNodeModules = ${JSON.stringify(templateNodeModules)}
const hakkaCoreRoot = path.resolve(workspaceRoot, 'packages/hakka-core')
const hakkaReactNativeRoot = path.resolve(workspaceRoot, 'packages/hakka-react-native')
const fflateRoot = ${includeHakka ? "path.dirname(require.resolve('fflate/package.json', { paths: [hakkaCoreRoot] }))" : 'null'}
const config = {
  projectRoot: __dirname,
  watchFolders: ${
    includeHakka ? '[hostNodeModules, hakkaCoreRoot, hakkaReactNativeRoot, fflateRoot]' : '[hostNodeModules]'
  },
  resolver: {
    useWatchman: false,
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')${
      includeHakka ? ", path.resolve(workspaceRoot, 'node_modules')" : ''
    }],
    extraNodeModules: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
      ${
        includeHakka
          ? "'hakka-core': path.resolve(workspaceRoot, 'packages/hakka-core'),\n      'hakka-react-native': path.resolve(workspaceRoot, 'packages/hakka-react-native'),"
          : ''
      }
    },
    unstable_enableSymlinks: true,
  },
}

const merged = mergeConfig(getDefaultConfig(__dirname), config)
module.exports = ${
    includeHakka
      ? `require(${JSON.stringify(resolve(workspaceRoot, 'packages/hakka-react-native/metro.js'))}).withHakka(merged)`
      : 'merged'
  }
`,
)
writeFileSync(
  resolve(outputDir, 'react-native.config.js'),
  `module.exports = { dependencies: { 'hakka-react-native': ${
    includeHakka
      ? `{ root: ${JSON.stringify(resolve(workspaceRoot, 'packages/hakka-react-native'))} }`
      : `{ platforms: { android: null, ios: null } }`
  } } }
`,
)
if (benchmarkPlatform === 'android') prepareAndroid()
if (benchmarkPlatform === 'ios') prepareIos()
console.log(`Prepared isolated benchmark app at ${outputDir}`)

function replaceRequired(path, search, replacement) {
  const source = readFileSync(path, 'utf8')
  if (!source.includes(search)) throw new Error(`Could not update generated file: ${path}`)
  writeFileSync(path, source.replace(search, replacement))
}

function prepareAndroid() {
  const packageDir = resolve(outputDir, 'android/app/src/main/java/com/noodleapps/hakka/rn')
  const gradlePath = resolve(outputDir, 'android/app/build.gradle')
  const applicationPath = resolve(packageDir, 'MainApplication.kt')
  const rootGradlePath = resolve(outputDir, 'android/build.gradle')
  const settingsPath = resolve(outputDir, 'android/settings.gradle')
  const wrapperPropertiesPath = resolve(outputDir, 'android/gradle/wrapper/gradle-wrapper.properties')
  const proguardPath = resolve(outputDir, 'android/app/proguard-rules.pro')
  mkdirSync(resolve(outputDir, 'android/app/src/chucker/java/com/noodleapps/hakka/rn'), { recursive: true })
  cpSync(resolve(fixtureDir, 'android/BenchmarkRuntimeModule.kt'), resolve(packageDir, 'BenchmarkRuntimeModule.kt'))
  const mainActivityPath = resolve(packageDir, 'MainActivity.kt')
  replaceRequired(
    mainActivityPath,
    'import com.facebook.react.ReactActivity\n',
    'import android.os.Bundle\nimport com.facebook.react.ReactActivity\n',
  )
  replaceRequired(
    mainActivityPath,
    'class MainActivity : ReactActivity() {\n',
    `class MainActivity : ReactActivity() {
  companion object {
    @Volatile var shouldShowHakkaInspector = false
      private set
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    shouldShowHakkaInspector = intent.getBooleanExtra("hakkaBenchmarkShowUI", false)
    super.onCreate(savedInstanceState)
  }

`,
  )
  cpSync(
    resolve(fixtureDir, 'android/BenchmarkNetworking.kt'),
    resolve(outputDir, 'android/app/src/chucker/java/com/noodleapps/hakka/rn/BenchmarkNetworking.kt'),
  )
  writeFileSync(
    applicationPath,
    `package com.noodleapps.hakka.rn

import android.app.Application
${includeHakka ? 'import android.content.Context\n' : ''}import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
${includeHakka ? 'import com.google.android.play.core.splitcompat.SplitCompat\n' : ''}

class MainApplication : Application(), ReactApplication {
${
  includeHakka
    ? `  override fun attachBaseContext(base: Context) {
    super.attachBaseContext(base)
    SplitCompat.install(this)
  }

`
    : ''
}  override val reactHost: ReactHost by lazy { getDefaultReactHost(applicationContext, PackageList(this).packages.apply { add(BenchmarkRuntimePackage()) }) }
  override fun onCreate() {
    super.onCreate()
    if (BuildConfig.BENCHMARK_VARIANT == "chucker") Class.forName("com.noodleapps.hakka.rn.BenchmarkNetworking").getMethod("install", android.content.Context::class.java).invoke(null, this)
    loadReactNative(this)
  }
}
`,
  )
  writeFileSync(
    settingsPath,
    `pluginManagement { includeBuild("../node_modules/@react-native/gradle-plugin") }
plugins { id("com.facebook.react.settings") }
extensions.configure(com.facebook.react.ReactSettingsExtension) { ex -> ex.autolinkLibrariesFromCommand() }
rootProject.name = 'HakkaRNExample'
include ':app'
${includeHakka ? "include ':hakkaInspector'\n" : ''}includeBuild('../node_modules/@react-native/gradle-plugin')
`,
  )
  let rootGradle = readFileSync(rootGradlePath, 'utf8').replace(/kotlinVersion = "[^"]+"/, 'kotlinVersion = "2.3.10"')
  if (includeHakka) {
    rootGradle += `

allprojects {
    repositories {
        google()
        mavenCentral()
        mavenLocal()
    }
}
`
  }
  if (!rootGradle.includes('kotlinVersion = "2.3.10"')) throw new Error('Could not configure Kotlin 2.3.10')
  writeFileSync(rootGradlePath, rootGradle)
  writeFileSync(
    wrapperPropertiesPath,
    readFileSync(wrapperPropertiesPath, 'utf8').replace(/networkTimeout=\d+/, 'networkTimeout=120000'),
  )
  if (benchmarkVariant === 'chucker') {
    writeFileSync(
      proguardPath,
      `${readFileSync(proguardPath, 'utf8')}
-keepclassmembers class com.noodleapps.hakka.rn.BenchmarkNetworking {
    public static void install(android.content.Context);
    public static int getPersistedCaptureCount(android.content.Context);
}
`,
    )
  }
  let gradle = readFileSync(gradlePath, 'utf8')
  gradle = gradle.replace('def enableProguardInReleaseBuilds = false', 'def enableProguardInReleaseBuilds = true')
  if (!gradle.includes('def enableProguardInReleaseBuilds = true')) {
    throw new Error('Could not enable Android release minification')
  }
  if (includeHakka) {
    gradle = gradle.replace(
      'android {',
      `def hakkaUiDelivery = findProperty("hakkaUiDelivery") ?: "play"

android {
    if (hakkaUiDelivery == "play") {
        dynamicFeatures = [":hakkaInspector"]
    }`,
    )
  }
  gradle = gradle.replace(
    '    signingConfigs {',
    `    flavorDimensions "benchmark"
    productFlavors {
        baseline { dimension "benchmark"; buildConfigField "String", "BENCHMARK_VARIANT", '"baseline"' }
        hakka { dimension "benchmark"; buildConfigField "String", "BENCHMARK_VARIANT", '"hakka"' }
        chucker { dimension "benchmark"; buildConfigField "String", "BENCHMARK_VARIANT", '"chucker"' }
    }
    signingConfigs {`,
  )
  const nativeDependencies =
    '    implementation("com.noodleapps.hakka:hakka-network:0.0.1")\n    implementation("com.noodleapps.hakka:hakka-performance:0.0.1")\n    // The sample exercises the same native inspector and capture path in every build type.\n    implementation("com.noodleapps.hakka:hakka-ui:0.0.1")'
  gradle = gradle.replace(nativeDependencies, '')
  gradle = gradle.replace(
    'dependencies {',
    `dependencies {
${
  includeHakka
    ? `    constraints {
        hakkaImplementation("androidx.activity:activity:1.12.1")
        hakkaImplementation("androidx.collection:collection:1.5.0")
        hakkaImplementation("androidx.core:core-ktx:1.17.0")
        hakkaImplementation("androidx.compose.runtime:runtime-annotation:1.10.0")
        hakkaImplementation("androidx.emoji2:emoji2:1.4.0")
        hakkaImplementation("androidx.emoji2:emoji2-views-helper:1.4.0")
        hakkaImplementation("androidx.lifecycle:lifecycle-runtime:2.9.4")
        hakkaImplementation("androidx.savedstate:savedstate:1.3.2")
    }
    hakkaImplementation("com.noodleapps.hakka:hakka-network:0.0.1")
    hakkaCompileOnly("com.google.android.play:feature-delivery:2.1.0")
    if (hakkaUiDelivery == "play") {
        hakkaImplementation("com.google.android.play:feature-delivery:2.1.0")
    } else if (hakkaUiDelivery == "bundled") {
        hakkaImplementation("com.noodleapps.hakka:hakka-ui:0.0.1")
    }
`
    : ''
}    chuckerImplementation("com.github.chuckerteam.chucker:library:4.3.1")`,
  )
  if (
    gradle.includes(nativeDependencies) ||
    !gradle.includes('library:4.3.1') ||
    (includeHakka &&
      (!gradle.includes('hakkaImplementation("androidx.collection:collection:1.5.0")') ||
        !gradle.includes('hakkaImplementation')))
  ) {
    throw new Error('Could not configure isolated Android inspector dependencies')
  }
  gradle += androidVariantFilter()
  writeFileSync(gradlePath, gradle)
  if (includeHakka) {
    cpSync(
      resolve(workspaceRoot, 'examples/react-native-example/android/hakkaInspector'),
      resolve(outputDir, 'android/hakkaInspector'),
      { recursive: true },
    )
    const featureGradlePath = resolve(outputDir, 'android/hakkaInspector/build.gradle')
    const featureGradle = `${readFileSync(featureGradlePath, 'utf8').replace(
      'android {',
      `android {
    flavorDimensions "benchmark"
    productFlavors {
        baseline { dimension "benchmark" }
        hakka { dimension "benchmark" }
        chucker { dimension "benchmark" }
    }`,
    )}${androidVariantFilter()}`
    writeFileSync(featureGradlePath, featureGradle)
    for (const resourcePath of ['values/hakka_inspector.xml', 'xml/hakka_inspector_file_paths.xml']) {
      const destination = resolve(outputDir, 'android/app/src/main/res', resourcePath)
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(
        resolve(workspaceRoot, 'examples/react-native-example/android/app/src/main/res', resourcePath),
        destination,
      )
    }
    const manifestPath = resolve(outputDir, 'android/app/src/main/AndroidManifest.xml')
    const manifest = readFileSync(manifestPath, 'utf8').replace(
      '      android:supportsRtl="true">',
      `      android:supportsRtl="true">
      <meta-data
        android:name="com.noodleapps.hakka.INSPECTOR_MODULE"
        android:value="hakkaInspector" />
`,
    )
    if (!manifest.includes('com.noodleapps.hakka.INSPECTOR_MODULE')) {
      throw new Error('Could not configure Play inspector module metadata')
    }
    writeFileSync(manifestPath, manifest)
  }
}

function androidVariantFilter() {
  return `

androidComponents {
    beforeVariants(selector().all()) { variantBuilder ->
        variantBuilder.enable = variantBuilder.productFlavors.any {
            it.first == "benchmark" && it.second == "${benchmarkVariant}"
        }
    }
}
`
}

function prepareIos() {
  const podfilePath = resolve(outputDir, 'ios/Podfile')
  rmSync(resolve(outputDir, 'ios/Podfile.lock'), { force: true })
  const projectPath = resolve(outputDir, 'ios/HakkaRNExample.xcodeproj/project.pbxproj')
  writeFileSync(
    projectPath,
    readFileSync(projectPath, 'utf8')
      .replaceAll(
        'PRODUCT_BUNDLE_IDENTIFIER = "com.noodleapps.hakka.rn";',
        `PRODUCT_BUNDLE_IDENTIFIER = "com.noodleapps.hakka.rn.benchmark.${benchmarkVariant}";`,
      )
      .replaceAll('IPHONEOS_DEPLOYMENT_TARGET = 15.1;', 'IPHONEOS_DEPLOYMENT_TARGET = 16.0;'),
  )
  let podfile = readFileSync(podfilePath, 'utf8')
  podfile = podfile.replace('platform :ios, min_ios_version_supported', "platform :ios, '16.0'")
  podfile = podfile.replace(
    "linkage = ENV['USE_FRAMEWORKS']",
    "ENV['USE_FRAMEWORKS'] = 'dynamic'\nlinkage = ENV['USE_FRAMEWORKS']",
  )
  podfile = podfile.replace(
    "target 'HakkaRNExample' do",
    `benchmarkVariant = '${benchmarkVariant}'
target 'HakkaRNExample' do`,
  )
  podfile = podfile.replace(
    '  post_install do |installer|',
    `  pod 'RNBenchmarkRuntime', :path => ${JSON.stringify(resolve(fixtureDir, 'ios'))}
  pod 'PulseObjCHelpers', :podspec => ${JSON.stringify(resolve(fixtureDir, 'ios/PulseObjCHelpers.podspec'))}, :modular_headers => true if benchmarkVariant == 'pulse'
  pod 'PulseCore', :podspec => ${JSON.stringify(resolve(fixtureDir, 'ios/PulseCore.podspec'))} if benchmarkVariant == 'pulse'
  pod 'PulseProxy', :podspec => ${JSON.stringify(resolve(fixtureDir, 'ios/PulseProxy.podspec'))} if benchmarkVariant == 'pulse'
  pod 'PulseUI', :podspec => ${JSON.stringify(resolve(fixtureDir, 'ios/PulseUI.podspec'))} if benchmarkVariant == 'pulse'
  pod 'Wormholy', :git => 'https://github.com/pmusolino/Wormholy.git', :tag => '2.4.0' if benchmarkVariant == 'wormholy'

  post_install do |installer|
    installer.pods_project.targets.each do |target|
      if target.name == 'PulseCore' || target.name == 'PulseUI'
        target.build_configurations.each do |configuration|
          configuration.build_settings['OTHER_SWIFT_FLAGS'] = "$(inherited) -package-name Pulse"
        end
      end
      next unless target.name == 'RNBenchmarkRuntime'
      target.build_configurations.each do |configuration|
        configuration.build_settings['OTHER_SWIFT_FLAGS'] = "$(inherited) -D BENCHMARK_#{benchmarkVariant.upcase}"
      end
    end`,
  )
  writeFileSync(podfilePath, podfile)
}
