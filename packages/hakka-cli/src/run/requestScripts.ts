import { Worker } from 'node:worker_threads'

import { throwIfAborted } from './values.js'
interface ScriptContext {
  env: Record<string, string>
  request?: { method: string; url: string; headers: Record<string, string>; body?: string }
  response?: { status: number; headers: Record<string, string>; body: string }
}

/** A fresh worker bounds hook lifetime and heap. It is isolation, not a security sandbox. */
export async function runScript(
  source: string[],
  context: ScriptContext,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ variables: Record<string, string>; request?: ScriptContext['request'] }> {
  if (!source.length) return { variables: {} }
  throwIfAborted(signal)
  const workerSource = `const { parentPort, workerData } = require('node:worker_threads'); const variables={}; globalThis.env=Object.freeze({...workerData.env}); globalThis.vars={set:(k,v)=>{if(typeof k==='string') variables[k]=String(v)}}; globalThis.log=()=>{}; if(workerData.request) globalThis.request=workerData.request; if(workerData.response) globalThis.response=workerData.response; try { eval(workerData.source); parentPort.postMessage({variables,request:globalThis.request}); } catch (error) { parentPort.postMessage({error:String(error && error.message || error)}); }`
  return await new Promise((resolveScript, reject) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: { ...context, source: source.join('\n') },
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8 },
      stdout: true,
      stderr: true,
    })
    worker.stdout.resume()
    worker.stderr.resume()
    let settled = false
    const finish = (
      error?: Error,
      result?: { variables: Record<string, string>; request?: ScriptContext['request'] },
    ) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      void worker.terminate()
      if (error) reject(error)
      else resolveScript(result!)
    }
    const abort = () => finish(new DOMException('run cancelled', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('script timed out')), Math.min(timeoutMs, 5_000))
    worker.once(
      'message',
      (result: { error?: string; variables?: Record<string, string>; request?: ScriptContext['request'] }) => {
        if (result.error) finish(new Error(`script failed: ${result.error}`))
        else finish(undefined, { variables: result.variables ?? {}, request: result.request })
      },
    )
    worker.once('error', (error: Error) => finish(new Error(`script failed: ${error.message}`)))
    worker.once('exit', () => finish(new Error('script exited before returning a result')))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
