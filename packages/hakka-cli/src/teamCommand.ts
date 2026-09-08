import { join } from 'node:path'
import { stdin } from 'node:process'

import { runTeamSnapshot } from './team/execution.js'
import { MonitorScheduler } from './team/monitors.js'
import { createTeamServer } from './team/server.js'
import { TeamStore, createToken } from './team/store.js'
import { syncCollection } from './team/sync.js'

const usage =
  'Usage: hakka team serve [--data FILE] [--token TOKEN] [--bind 127.0.0.1] [--port 7137]\n       hakka team push DIRECTORY --url URL --token TOKEN\n       hakka team pull DIRECTORY --url URL --token TOKEN'
export async function teamCommand(args: string[]): Promise<number> {
  const [command, ...rest] = args
  if (command === 'serve') return serve(rest)
  if (command === 'secret') return secret(rest)
  if (command === 'push' || command === 'pull') return sync(command, rest)
  process.stderr.write(`${usage}\n`)
  return 2
}
async function secret(args: string[]): Promise<number> {
  const [ref] = args
  const base = option(args, '--url')
  const token = option(args, '--token')
  if (!ref || !base || !token) throw new Error('Usage: hakka team secret REF --url URL --token TOKEN < value')
  let value = ''
  for await (const chunk of stdin) value += chunk
  value = value.replace(/\r?\n$/, '')
  if (!value) throw new Error('Secret stdin is empty')
  const response = await fetch(`${base.replace(/\/$/, '')}/api/v1/secrets/${encodeURIComponent(ref)}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!response.ok) throw new Error(`secret write failed: ${response.status}`)
  process.stdout.write(JSON.stringify({ status: 'stored', ref }) + '\n')
  return 0
}
function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
async function serve(args: string[]): Promise<number> {
  const host = option(args, '--bind') ?? '127.0.0.1'
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !option(args, '--token'))
    throw new Error('A --token is required when binding beyond localhost')
  const data = option(args, '--data') ?? join(process.cwd(), '.hakka', 'team-state.json')
  const token = option(args, '--token') ?? createToken()
  const store = new TeamStore(data)
  await store.open()
  const bootstrapped = await store.bootstrap(token)
  const server = createTeamServer(store)
  const scheduler = new MonitorScheduler(store, runTeamSnapshot)
  scheduler.start()
  const ready = await server.listen(Number(option(args, '--port') ?? 7137), host)
  process.stdout.write(
    JSON.stringify({
      status: 'ready',
      url: `http://${host}:${ready.port}`,
      data,
      bootstrapToken: bootstrapped && !option(args, '--token') ? token : undefined,
    }) + '\n',
  )
  await new Promise<void>((resolve) => {
    const shutdown = () => void Promise.all([scheduler.stop(), server.close()]).finally(resolve)
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
  return 0
}
async function sync(command: 'push' | 'pull', args: string[]): Promise<number> {
  if (!args[0] || !option(args, '--url') || !option(args, '--token')) throw new Error(usage)
  await syncCollection(command, args)
  return 0
}
