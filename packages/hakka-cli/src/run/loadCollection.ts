import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'

import {
  RequestFileValidationError,
  validateNativeCollectionMetadata,
  validateNativeFolderMetadata,
  validateNativeRequestEnvelope,
} from '../workspace/requestFileValidator.js'
import type { ObjectJson, Header, RequestSpec, Collection, LoadedRequest } from './types.js'
import { number, object, text } from './values.js'
async function readJson(path: string): Promise<ObjectJson> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (value == null || Array.isArray(value) || typeof value !== 'object')
    throw new Error(`${path} must contain a JSON object`)
  return value as ObjectJson
}

function validate(path: string, operation: () => void): void {
  try {
    operation()
  } catch (error) {
    if (error instanceof RequestFileValidationError) throw new Error(`${path}: ${error.message}`)
    throw error
  }
}

async function readFolderMetadata(path: string): Promise<ObjectJson | undefined> {
  const file = join(path, 'folder.hakka')
  try {
    return await readJson(file)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function loadDirectory(
  path: string,
  inheritedHeaders: Header[] = [],
  inheritedAuth: ObjectJson = {},
  root = path,
): Promise<LoadedRequest[]> {
  const entries = await readdir(path, { withFileTypes: true })
  const candidates: Array<{
    seq: number
    name: string
    run?: LoadedRequest
    folder?: string
    headers?: Header[]
    auth?: ObjectJson
  }> = []
  for (const entry of entries) {
    const absolute = join(path, entry.name)
    if (entry.isDirectory()) {
      const meta = await readFolderMetadata(absolute)
      if (meta) {
        validate(join(absolute, 'folder.hakka'), () => validateNativeFolderMetadata(meta))
        candidates.push({
          seq: number(meta.seq) ?? Number.MAX_SAFE_INTEGER,
          name: entry.name,
          folder: absolute,
          headers: (meta.headers as unknown as Header[] | undefined) ?? [],
          auth: object(meta.auth),
        })
      }
    } else if (extname(entry.name) === '.hakka' && entry.name !== 'collection.hakka' && entry.name !== 'folder.hakka') {
      const disk = await readJson(absolute)
      validate(absolute, () => validateNativeRequestEnvelope(disk))
      const spec = object(disk.spec) as unknown as RequestSpec
      if (!text(spec.name) || !text(spec.url) || !text(spec.method))
        throw new Error(`${absolute} has no valid RequestSpec`)
      candidates.push({
        seq: number(disk.seq) ?? Number.MAX_SAFE_INTEGER,
        name: entry.name,
        run: { request: spec, headers: inheritedHeaders, auth: inheritedAuth, path: absolute, root },
      })
    }
  }
  candidates.sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name))
  const result: LoadedRequest[] = []
  for (const candidate of candidates) {
    if (candidate.run) result.push(candidate.run)
    else if (candidate.folder) {
      const auth =
        candidate.auth == null || Object.keys(candidate.auth).length === 0 || 'inherit' in candidate.auth
          ? inheritedAuth
          : candidate.auth
      result.push(
        ...(await loadDirectory(candidate.folder, [...inheritedHeaders, ...(candidate.headers ?? [])], auth, root)),
      )
    }
  }
  return result
}

export async function loadCollection(
  input: string,
  folder?: string,
): Promise<{ collection: Collection; requests: LoadedRequest[] }> {
  const path = resolve(input)
  if (extname(path) === '.hakka') {
    const disk = await readJson(path)
    validate(path, () => validateNativeRequestEnvelope(disk))
    const spec = object(disk.spec) as unknown as RequestSpec
    return {
      collection: { id: 'single', name: basename(path) },
      requests: [{ request: spec, headers: [], auth: {}, path, root: dirname(path) }],
    }
  }
  const collection = (await readJson(join(path, 'collection.hakka'))) as unknown as Collection
  validate(join(path, 'collection.hakka'), () => validateNativeCollectionMetadata(collection as unknown as ObjectJson))
  if (!folder)
    return { collection, requests: await loadDirectory(path, collection.defaultHeaders ?? [], object(collection.auth)) }
  const pieces = folder.split(/[\\/]/).filter(Boolean)
  if (!pieces.length || pieces.some((piece) => piece === '.' || piece === '..'))
    throw new Error('--folder must be a collection-relative folder path')
  let root = path
  let headers = collection.defaultHeaders ?? []
  let auth = object(collection.auth)
  for (const piece of pieces) {
    root = join(root, piece)
    const metadata = await readJson(join(root, 'folder.hakka'))
    validate(join(root, 'folder.hakka'), () => validateNativeFolderMetadata(metadata))
    headers = [...headers, ...((metadata.headers as unknown as Header[] | undefined) ?? [])]
    const candidate = object(metadata.auth)
    if (!('inherit' in candidate) && Object.keys(candidate).length) auth = candidate
  }
  return { collection, requests: await loadDirectory(root, headers, auth) }
}
