import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'

import type { ObjectJson } from './types.js'
import { object, text, interpolate, enabled } from './values.js'
const maxUploadBytes = 5 * 1024 * 1024

function collectionFile(root: string, value: string): string {
  const candidate = resolve(root, value)
  if (isAbsolute(value) || relative(root, candidate).startsWith('..'))
    throw new Error('file bodies must be relative to the collection directory')
  return candidate
}

async function readUpload(root: string, value: string): Promise<Uint8Array> {
  const [base, candidate] = await Promise.all([realpath(root), realpath(collectionFile(root, value))])
  const distance = relative(base, candidate)
  if (distance === '..' || distance.startsWith('../') || isAbsolute(distance))
    throw new Error('upload resolves outside the collection directory')
  const file = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > maxUploadBytes)
      throw new Error('upload must be a regular file no larger than 5 MiB')
    const bytes = Buffer.alloc(maxUploadBytes + 1)
    let size = 0
    while (size < bytes.length) {
      const next = await file.read(bytes, size, bytes.length - size, null)
      if (!next.bytesRead) break
      size += next.bytesRead
    }
    if (size > maxUploadBytes) throw new Error('upload body exceeds 5 MiB limit')
    return bytes.subarray(0, size)
  } finally {
    await file.close()
  }
}

export async function decodeBody(
  body: ObjectJson | undefined,
  variables: Record<string, string>,
  root: string,
): Promise<{ body?: string | Uint8Array | FormData; contentType?: string }> {
  if (!body || 'none' in body) return {}
  const raw = object(body.raw)
  if (Object.keys(raw).length)
    return { body: interpolate(text(raw.text) ?? '', variables), contentType: text(raw.contentType) }
  const graphql = object(body.graphql)
  if (Object.keys(graphql).length)
    return {
      body: JSON.stringify({
        query: interpolate(text(graphql.query) ?? '', variables),
        variables: JSON.parse(interpolate(text(graphql.variables) ?? '{}', variables)),
        operationName: text(graphql.operationName),
      }),
      contentType: 'application/json',
    }
  const form = object(body.form)
  const formItems = Array.isArray(form._0) ? form._0 : body.form
  if (Array.isArray(formItems))
    return {
      body: formItems
        .map((item) => object(item))
        .filter(enabled)
        .map(
          (item) =>
            `${encodeURIComponent(interpolate(text(item.name) ?? '', variables))}=${encodeURIComponent(interpolate(text(item.value) ?? '', variables))}`,
        )
        .join('&'),
      contentType: 'application/x-www-form-urlencoded',
    }
  const file = object(body.file)
  if (Object.keys(file).length)
    return {
      body: await readUpload(root, interpolate(text(file.path) ?? '', variables)),
      contentType: text(file.contentType) ?? 'application/octet-stream',
    }
  const multipart = object(body.multipart)
  const parts = Array.isArray(multipart._0) ? multipart._0 : []
  if (parts.length) {
    const form = new FormData()
    let size = 0
    for (const rawPart of parts.map(object).filter(enabled)) {
      const name = interpolate(text(rawPart.name) ?? '', variables)
      const filePath = text(rawPart.filePath)
      if (filePath) {
        const bytes = await readUpload(root, interpolate(filePath, variables))
        size += bytes.byteLength
        if (size > maxUploadBytes) throw new Error('multipart upload exceeds 5 MiB limit')
        const fileName = basename(filePath)
        form.append(
          name,
          new Blob([Buffer.from(bytes)], { type: text(rawPart.contentType) ?? 'application/octet-stream' }),
          fileName,
        )
      } else {
        const value = interpolate(text(rawPart.value) ?? '', variables)
        size += Buffer.byteLength(value)
        if (size > maxUploadBytes) throw new Error('multipart upload exceeds 5 MiB limit')
        form.append(name, value)
      }
    }
    return { body: form }
  }
  throw new Error(`unsupported body type in runner (${Object.keys(body).join(', ')})`)
}
