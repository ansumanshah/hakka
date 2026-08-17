#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const [file, ...pairs] = process.argv.slice(2)

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!file || pairs.length === 0) {
  fail('Usage: benchmark-artifact-metadata.mjs <artifact.json> key=value ...')
}

if (!fs.existsSync(file)) {
  fail(`Missing artifact: ${file}`)
}

const payload = JSON.parse(fs.readFileSync(file, 'utf8'))
const metadata = {}

for (const pair of pairs) {
  const separator = pair.indexOf('=')
  if (separator <= 0) fail(`Invalid metadata pair: ${pair}`)
  const key = pair.slice(0, separator)
  const value = pair.slice(separator + 1)
  if (!key.trim()) fail(`Invalid metadata key: ${pair}`)
  if (!value.trim()) fail(`Invalid metadata value for ${key}`)
  metadata[key] = value
}

payload.environment = {
  ...payload.environment,
  ...metadata,
  collectedAt: new Date().toISOString(),
}

fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
