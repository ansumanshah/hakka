import { runCollection } from './runner.js'
import type { RunOptions, RunReport } from './types.js'
import { safeText } from './values.js'
export async function runCommand(args: string[]): Promise<number> {
  let input: string | undefined
  const options: RunOptions = { environment: {} }
  try {
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!
      const next = (): string => {
        const value = args[++index]
        if (!value) throw new Error(`${arg} requires a value`)
        return value
      }
      if (!arg.startsWith('--') && !input) input = arg
      else if (arg === '--env') {
        const pair = next()
        const equals = pair.indexOf('=')
        if (equals < 1) throw new Error('--env requires NAME=value')
        options.environment![pair.slice(0, equals)] = pair.slice(equals + 1)
      } else if (arg === '--folder') options.folder = next()
      else if (arg === '--data') options.dataFile = next()
      else if (arg === '--repeat') options.repeat = Number(next())
      else if (arg === '--delay-ms') options.delayMs = Number(next())
      else if (arg === '--timeout-ms') options.timeoutMs = Number(next())
      else if (arg === '--json') options.json = true
      else if (arg === '--json-report') options.jsonReport = next()
      else if (arg === '--junit-report') options.junitReport = next()
      else throw new Error(`unknown run option: ${arg}`)
    }
  } catch (error) {
    return commandError(args.includes('--json'), error)
  }
  if (!input)
    return commandError(
      options.json,
      new Error(
        'Usage: hakka run <collection-directory|request.hakka> [--env NAME=value] [--folder path] [--data rows.json|rows.csv] [--repeat N] [--delay-ms N] [--timeout-ms N] [--json-report path] [--junit-report path]',
      ),
    )
  let report: RunReport
  try {
    report = await runCollection(input, options)
  } catch (error) {
    return commandError(options.json, error)
  }
  process.stdout.write(
    options.json
      ? `${JSON.stringify(report)}\n`
      : `Hakka run: ${report.passed} passed, ${report.failed} failed (${report.items.length} requests)\n`,
  )
  return report.failed ? 1 : 0
}

function commandError(json: boolean | undefined, error: unknown): number {
  const message = safeText(error instanceof Error ? error.message : 'run failed')
  if (json) process.stdout.write(`${JSON.stringify({ outcome: 'error', error: message })}\n`)
  else process.stderr.write(`hakka run: ${message}\n`)
  return 2
}
