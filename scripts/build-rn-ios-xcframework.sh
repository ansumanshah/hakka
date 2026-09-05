#!/usr/bin/env bash
# Build the static HakkaNative XCFramework from the generated RN Swift sources.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
package_root="$repo_root/packages/hakka-react-native"
output_root="${HAKKA_RN_IOS_XCFRAMEWORK_OUTPUT:-$package_root/ios/Frameworks}"
artifact_root="${HAKKA_RN_IOS_XCFRAMEWORK_ARTIFACTS:-$repo_root/artifacts/rn-ios-binary}"
spec_path="$repo_root/scripts/rn-ios-xcframework-project.yml"
output_path="$output_root/HakkaNative.xcframework"

if ! xcodegen_bin="$(command -v xcodegen)"; then
  echo "ERROR: xcodegen is required on PATH" >&2
  exit 1
fi

mkdir -p "$artifact_root" "$output_root"
build_root="$(mktemp -d "$artifact_root/build.XXXXXX")"
project_root="$build_root/project"
staging_root="$build_root/output"
manifest_path="$staging_root/HakkaNative.build-manifest.json"
trap 'rm -rf "$build_root"' EXIT

run_logged() {
  local name="$1"
  shift
  "$@" 2>&1 | tee "$artifact_root/$name.log" | xcbeautify --quiet --is-ci
}

cd "$repo_root"
node scripts/sync-rn-ios.mjs --check

mkdir -p "$project_root" "$staging_root"
"$xcodegen_bin" generate --quiet --spec "$spec_path" --project "$project_root" --project-root "$repo_root"

project_path="$project_root/HakkaNative.xcodeproj"
run_logged archive-device xcodebuild archive \
  -project "$project_path" \
  -scheme HakkaNative \
  -configuration Release \
  -derivedDataPath "$build_root/DerivedData" \
  -destination 'generic/platform=iOS' \
  -archivePath "$build_root/HakkaNative-iOS.xcarchive" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' \
  BUILD_LIBRARY_FOR_DISTRIBUTION=YES SKIP_INSTALL=NO ARCHS=arm64 ONLY_ACTIVE_ARCH=NO
run_logged archive-simulator xcodebuild archive \
  -project "$project_path" \
  -scheme HakkaNative \
  -configuration Release \
  -derivedDataPath "$build_root/DerivedData" \
  -destination 'generic/platform=iOS Simulator' \
  -archivePath "$build_root/HakkaNative-iOS-Simulator.xcarchive" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' \
  BUILD_LIBRARY_FOR_DISTRIBUTION=YES SKIP_INSTALL=NO ARCHS='arm64 x86_64' ONLY_ACTIVE_ARCH=NO
run_logged create-xcframework xcodebuild -create-xcframework \
  -framework "$build_root/HakkaNative-iOS.xcarchive/Products/Library/Frameworks/HakkaNative.framework" \
  -framework "$build_root/HakkaNative-iOS-Simulator.xcarchive/Products/Library/Frameworks/HakkaNative.framework" \
  -output "$staging_root/HakkaNative.xcframework"

node --input-type=module - "$repo_root" "$staging_root/HakkaNative.xcframework/HakkaNative.build-manifest.json" <<'NODE'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const [repoRoot, manifestPath] = process.argv.slice(2)
const packageRoot = join(repoRoot, 'packages/hakka-react-native')
const sourceRoot = join(packageRoot, 'ios')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const collect = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name)
  if (entry.isDirectory()) return collect(path)
  return entry.isFile() && entry.name.endsWith('.swift') ? [path] : []
})
const files = ['Core', 'Performance', 'UI'].flatMap((name) => collect(join(sourceRoot, name))).sort().map((path) => ({
  path: relative(sourceRoot, path),
  sha256: sha256(readFileSync(path)),
}))
const frameworkRoot = join(manifestPath, '..')
const slices = [
  'ios-arm64/HakkaNative.framework/HakkaNative',
  'ios-arm64_x86_64-simulator/HakkaNative.framework/HakkaNative',
].map((path) => ({ path, sha256: sha256(readFileSync(join(frameworkRoot, path))) }))
const manifest = {
  schemaVersion: 1,
  module: 'HakkaNative',
  packageVersion: JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version,
  source: {
    fileCount: files.length,
    sha256: sha256(files.map(({ path, sha256: hash }) => `${path}\t${hash}\n`).join('')),
    files,
  },
  builderSpec: {
    path: 'scripts/rn-ios-xcframework-project.yml',
    sha256: sha256(readFileSync(join(repoRoot, 'scripts/rn-ios-xcframework-project.yml'))),
  },
  builderScript: {
    path: 'scripts/build-rn-ios-xcframework.sh',
    sha256: sha256(readFileSync(join(repoRoot, 'scripts/build-rn-ios-xcframework.sh'))),
  },
  build: {
    configuration: 'Release',
    deploymentTarget: '16.0',
    libraryForDistribution: true,
    static: true,
    slices,
  },
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
NODE

rm -rf "$output_path"
mv "$staging_root/HakkaNative.xcframework" "$output_path"
node scripts/verify-rn-ios-xcframework.mjs

echo "Built HakkaNative XCFramework: $output_path"
