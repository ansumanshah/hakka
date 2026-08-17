#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

function run(command, args) {
  try {
    return {
      ok: true,
      output: execFileSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000,
      }),
    }
  } catch (error) {
    return {
      ok: false,
      output: String(error.stdout ?? ''),
      error: String(error.stderr ?? error.message ?? error),
    }
  }
}

function parseAdbDevices(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .map((line) => {
      const [serial, state, ...details] = line.split(/\s+/)
      return { serial, state, details: details.join(' ') }
    })
}

function parseXctraceDevices(output) {
  const lines = output.split('\n')
  let section = ''
  const devices = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const heading = line.match(/^==\s*(.+?)\s*==$/)
    if (heading) {
      section = heading[1]
      continue
    }
    const match = line.match(/^(.*?)\s+\(([^()]+)\)\s+\(([^()]+)\)$/)
    if (!match) continue
    const [, name, osVersion, id] = match
    const isMac = /^mac[- ]/i.test(name)
    devices.push({
      name,
      osVersion,
      id,
      section,
      online: section === 'Devices',
      physicalIos: !isMac && /Devices/.test(section),
    })
  }

  return devices
}

export function getDeviceReadiness() {
  if (process.env.HAKKA_DEVICE_READINESS_FILE) {
    return JSON.parse(fs.readFileSync(process.env.HAKKA_DEVICE_READINESS_FILE, 'utf8'))
  }

  const adb = run('adb', ['devices', '-l'])
  const androidDevices = adb.ok ? parseAdbDevices(adb.output) : []
  const readyAndroidDevices = androidDevices.filter((device) => device.state === 'device')

  const xctrace = run('xcrun', ['xctrace', 'list', 'devices'])
  const appleDevices = xctrace.ok ? parseXctraceDevices(xctrace.output) : []
  const readyIosDevices = appleDevices.filter((device) => device.physicalIos && device.online)
  const offlineIosDevices = appleDevices.filter((device) => device.physicalIos && !device.online)

  return {
    generatedAt: new Date().toISOString(),
    android: {
      commandAvailable: adb.ok,
      ready: readyAndroidDevices.length > 0,
      devices: androidDevices,
      readyDevices: readyAndroidDevices,
      error: adb.ok ? null : adb.error,
    },
    ios: {
      commandAvailable: xctrace.ok,
      ready: readyIosDevices.length > 0,
      devices: appleDevices,
      readyDevices: readyIosDevices,
      offlineDevices: offlineIosDevices,
      error: xctrace.ok ? null : xctrace.error,
    },
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(getDeviceReadiness(), null, 2))
}
