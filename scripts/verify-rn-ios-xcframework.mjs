#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(repoRoot, 'packages/hakka-react-native')
const frameworkRoot = resolve(process.env.HAKKA_RN_IOS_XCFRAMEWORK_OUTPUT ?? join(packageRoot, 'ios/Frameworks'))
const xcframeworkPath = join(frameworkRoot, 'HakkaNative.xcframework')
const manifestPath = join(xcframeworkPath, 'HakkaNative.build-manifest.json')
const specPath = join(repoRoot, 'scripts/rn-ios-xcframework-project.yml')
const builderPath = join(repoRoot, 'scripts/build-rn-ios-xcframework.sh')
const allowMissing = process.argv.includes('--allow-missing')

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function collectSwiftFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectSwiftFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.swift')) files.push(path)
  }
  return files
}

function sourceState() {
  const sourceRoot = join(packageRoot, 'ios')
  const files = ['Core', 'Performance', 'UI']
    .flatMap((directory) => collectSwiftFiles(join(sourceRoot, directory)))
    .sort()
    .map((path) => {
      const relativePath = relative(sourceRoot, path)
      return { path: relativePath, sha256: sha256(readFileSync(path)) }
    })
  const digest = sha256(files.map(({ path, sha256: hash }) => `${path}\t${hash}\n`).join(''))
  return { files, digest }
}

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exitCode = 1
}

if (!existsSync(xcframeworkPath)) {
  if (allowMissing) {
    console.log(`HakkaNative XCFramework is absent (allowed): ${xcframeworkPath}`)
  } else {
    fail(`HakkaNative XCFramework is required: ${xcframeworkPath}`)
  }
} else if (!existsSync(manifestPath)) {
  fail(`HakkaNative XCFramework provenance manifest is missing: ${manifestPath}`)
} else {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    fail(
      `HakkaNative XCFramework provenance manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (manifest) {
    const expectedSource = sourceState()
    const packageVersion = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version
    const expectedSpecHash = sha256(readFileSync(specPath))
    const expectedSlices = [
      'ios-arm64/HakkaNative.framework/HakkaNative',
      'ios-arm64_x86_64-simulator/HakkaNative.framework/HakkaNative',
    ]

    if (manifest.schemaVersion !== 1) fail(`unsupported manifest schema: ${manifest.schemaVersion}`)
    if (manifest.module !== 'HakkaNative') fail(`unexpected manifest module: ${manifest.module}`)
    if (manifest.packageVersion !== packageVersion)
      fail(`package version changed from ${manifest.packageVersion} to ${packageVersion}; rebuild HakkaNative`)
    if (manifest.source?.fileCount !== expectedSource.files.length)
      fail(
        `source file count changed from ${manifest.source?.fileCount} to ${expectedSource.files.length}; rebuild HakkaNative`,
      )
    if (manifest.source?.sha256 !== expectedSource.digest)
      fail('generated Core, Performance, or UI source hash changed; rebuild HakkaNative')
    if (manifest.builderSpec?.sha256 !== expectedSpecHash) fail('XcodeGen builder spec changed; rebuild HakkaNative')
    if (manifest.builderScript?.sha256 !== sha256(readFileSync(builderPath)))
      fail('XCFramework builder script changed; rebuild HakkaNative')
    if (
      manifest.source?.files?.some(
        ({ path }) => path === '../RNHakkaCoreBridge.swift' || path === 'RNHakkaCoreBridge.swift',
      )
    )
      fail('manifest includes the React Native bridge, which must not be in HakkaNative')

    for (const slice of expectedSlices) {
      if (!existsSync(join(xcframeworkPath, slice))) fail(`XCFramework slice is missing: ${slice}`)
      else if (
        manifest.build?.slices?.find(({ path }) => path === slice)?.sha256 !==
        sha256(readFileSync(join(xcframeworkPath, slice)))
      ) {
        fail(`XCFramework slice checksum does not match: ${slice}`)
      }
    }

    const infoPath = join(xcframeworkPath, 'Info.plist')
    if (!existsSync(infoPath)) fail('XCFramework Info.plist is missing')
    else {
      const info = readFileSync(infoPath, 'utf8')
      for (const libraryIdentifier of ['ios-arm64', 'ios-arm64_x86_64-simulator']) {
        if (!info.includes(`<string>${libraryIdentifier}</string>`))
          fail(`Info.plist does not describe ${libraryIdentifier}`)
      }
    }

    if (process.exitCode !== 1) {
      console.log(
        `HakkaNative XCFramework is current (${expectedSource.files.length} generated Swift files, ${expectedSource.digest}).`,
      )
    }
  }
}
