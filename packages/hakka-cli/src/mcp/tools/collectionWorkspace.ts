import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { CollectionWorkspace, WorkspaceError } from '../../workspace/CollectionWorkspace.js'
import { textResult } from './toolResult.js'

const json = z.record(z.string(), z.unknown())
const expected = z
  .string()
  .min(8)
  .describe('Revision returned by a preceding read. Required for every update or delete.')

function failure(error: unknown) {
  if (error instanceof WorkspaceError) return textResult({ error: error.code, message: error.message }, true)
  return textResult(
    { error: 'collection_workspace_failed', message: 'The collection workspace operation failed.' },
    true,
  )
}

/** Registers safe authoring tools. `root` should be an explicit HAKKA_WORKSPACE_DIR. */
export function registerCollectionWorkspaceTools(server: McpServer, root?: string): void {
  const workspace = root ? new CollectionWorkspace(root) : CollectionWorkspace.fromEnvironment()
  server.registerTool(
    'list_collections',
    {
      description: 'List Hakka collections in the configured workspace. This never executes requests.',
      annotations: { readOnlyHint: true },
      inputSchema: { limit: z.number().int().min(1).max(100).default(50) },
    },
    async ({ limit }) => {
      try {
        return textResult({ collections: await workspace.listCollections(limit) })
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'create_collection',
    {
      description: 'Create an empty canonical Hakka collection. This never executes requests.',
      annotations: { destructiveHint: false, idempotentHint: false },
      inputSchema: {
        name: z.string().min(1).max(120),
        id: z.string().min(1).optional(),
        notes: z.string().nullable().optional(),
      },
    },
    async (input) => {
      try {
        return textResult(await workspace.createCollection(input))
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'read_collection',
    {
      description: 'Read a collection and its optimistic-concurrency revision.',
      annotations: { readOnlyHint: true },
      inputSchema: { collectionId: z.string().min(1) },
    },
    async ({ collectionId }) => {
      try {
        return textResult(await workspace.readCollection(collectionId))
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'update_collection',
    {
      description: 'Update collection metadata using its read revision.',
      inputSchema: {
        collectionId: z.string().min(1),
        expectedRevision: expected,
        name: z.string().min(1).max(120).optional(),
        notes: z.string().nullable().optional(),
      },
    },
    async ({ collectionId, ...patch }) => {
      try {
        return textResult(await workspace.updateCollection(collectionId, patch))
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'delete_collection',
    {
      description: 'Delete one collection identified by ID and revision.',
      annotations: { destructiveHint: true },
      inputSchema: { collectionId: z.string().min(1), expectedRevision: expected },
    },
    async ({ collectionId, expectedRevision }) => {
      try {
        await workspace.deleteCollection(collectionId, expectedRevision)
        return textResult({ deleted: collectionId })
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'create_folder',
    {
      description: 'Create a folder in a collection. This never executes requests.',
      inputSchema: {
        collectionId: z.string().min(1),
        name: z.string().min(1).max(120),
        parentFolderId: z.string().min(1).optional(),
        id: z.string().min(1).optional(),
      },
    },
    async ({ collectionId, ...input }) => {
      try {
        return textResult(await workspace.createFolder(collectionId, input))
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'read_folder',
    {
      description: 'Read folder metadata and revision.',
      annotations: { readOnlyHint: true },
      inputSchema: { collectionId: z.string().min(1), folderId: z.string().min(1) },
    },
    async ({ collectionId, folderId }) => {
      try {
        return textResult(await workspace.readFolder(collectionId, folderId))
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'update_folder',
    {
      description: 'Update folder metadata using its read revision.',
      inputSchema: {
        collectionId: z.string().min(1),
        folderId: z.string().min(1),
        expectedRevision: expected,
        name: z.string().min(1).max(120).optional(),
        headers: z.array(json).optional(),
        auth: json.optional(),
      },
    },
    async ({ collectionId, folderId, ...patch }) => {
      try {
        return textResult(await workspace.updateFolder(collectionId, folderId, patch as never))
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'create_collection_request',
    {
      description: 'Create a canonical request file. This only authors files; it never sends the request.',
      inputSchema: {
        collectionId: z.string().min(1),
        parentFolderId: z.string().min(1).optional(),
        name: z.string().min(1).max(120),
        method: z.string().optional(),
        url: z.string().optional(),
        id: z.string().optional(),
        headers: z.array(json).optional(),
        query: z.array(json).optional(),
        body: json.optional(),
        auth: json.optional(),
        assertions: z.array(json).optional(),
        captures: z.array(json).optional(),
        notes: z.string().nullable().optional(),
        timeout: z.number().positive().nullable().optional(),
        followRedirects: z.boolean().optional(),
        scripts: json.nullable().optional(),
        session: z
          .object({
            webSocket: z
              .object({
                sendFrames: z.array(z.object({ data: z.string(), isBinary: z.boolean() })).max(100),
                maxFrames: z.number().int().min(1).max(100),
                timeoutMs: z.number().int().min(1).max(60000),
              })
              .optional(),
            sse: z
              .object({ maxEvents: z.number().int().min(1).max(100), timeoutMs: z.number().int().min(1).max(60000) })
              .optional(),
          })
          .refine(
            (value) => Number(value.webSocket !== undefined) + Number(value.sse !== undefined) === 1,
            'provide exactly one session variant',
          )
          .optional(),
      },
    },
    async ({ collectionId, ...input }) => {
      try {
        return textResult(await workspace.createRequest(collectionId, input as never))
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'read_collection_request',
    {
      description: 'Read a request and revision without executing it.',
      annotations: { readOnlyHint: true },
      inputSchema: { collectionId: z.string().min(1), requestId: z.string().min(1) },
    },
    async ({ collectionId, requestId }) => {
      try {
        return textResult(await workspace.readRequest(collectionId, requestId))
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'update_collection_request',
    {
      description: 'Update a request using its read revision. This never executes it.',
      inputSchema: {
        collectionId: z.string().min(1),
        requestId: z.string().min(1),
        expectedRevision: expected,
        name: z.string().min(1).max(120).optional(),
        method: z.string().optional(),
        url: z.string().optional(),
        headers: z.array(json).optional(),
        query: z.array(json).optional(),
        body: json.optional(),
        auth: json.optional(),
        assertions: z.array(json).optional(),
        captures: z.array(json).optional(),
        notes: z.string().nullable().optional(),
        timeout: z.number().positive().nullable().optional(),
        followRedirects: z.boolean().optional(),
        scripts: json.nullable().optional(),
        session: z
          .object({
            webSocket: z
              .object({
                sendFrames: z.array(z.object({ data: z.string(), isBinary: z.boolean() })).max(100),
                maxFrames: z.number().int().min(1).max(100),
                timeoutMs: z.number().int().min(1).max(60000),
              })
              .optional(),
            sse: z
              .object({ maxEvents: z.number().int().min(1).max(100), timeoutMs: z.number().int().min(1).max(60000) })
              .optional(),
          })
          .refine(
            (value) => Number(value.webSocket !== undefined) + Number(value.sse !== undefined) === 1,
            'provide exactly one session variant',
          )
          .nullable()
          .optional(),
      },
    },
    async ({ collectionId, requestId, ...patch }) => {
      try {
        return textResult(await workspace.updateRequest(collectionId, requestId, patch as never))
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'delete_collection_node',
    {
      description: 'Delete one folder or request identified by node ID and revision.',
      annotations: { destructiveHint: true },
      inputSchema: { collectionId: z.string().min(1), nodeId: z.string().min(1), expectedRevision: expected },
    },
    async ({ collectionId, nodeId, expectedRevision }) => {
      try {
        await workspace.deleteNode(collectionId, nodeId, expectedRevision)
        return textResult({ deleted: nodeId })
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'list_environments',
    {
      description: 'List environment metadata; secret values are never returned.',
      annotations: { readOnlyHint: true },
      inputSchema: { collectionId: z.string().min(1), limit: z.number().int().min(1).max(100).default(50) },
    },
    async ({ collectionId, limit }) => {
      try {
        return textResult({ environments: await workspace.listEnvironments(collectionId, limit) })
      } catch (e) {
        return failure(e)
      }
    },
  )
  const variable = z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(120),
    value: z.string().optional(),
    secret: z.boolean().optional(),
    secretRef: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  server.registerTool(
    'create_environment',
    {
      description:
        'Create an environment. Secret variables require secretRef and persist only a keychain reference token.',
      inputSchema: {
        collectionId: z.string().min(1),
        id: z.string().optional(),
        name: z.string().min(1).max(120),
        variables: z.array(variable).max(100).optional(),
      },
    },
    async ({ collectionId, ...input }) => {
      try {
        return textResult(await workspace.createEnvironment(collectionId, input))
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'read_environment',
    {
      description: 'Read environment metadata with all secret values redacted.',
      annotations: { readOnlyHint: true },
      inputSchema: { collectionId: z.string().min(1), environmentId: z.string().min(1) },
    },
    async ({ collectionId, environmentId }) => {
      try {
        return textResult(await workspace.readEnvironment(collectionId, environmentId))
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'update_environment',
    {
      description: 'Update an environment using its read revision. Secret variables require secretRef.',
      inputSchema: {
        collectionId: z.string().min(1),
        environmentId: z.string().min(1),
        expectedRevision: expected,
        name: z.string().min(1).max(120).optional(),
        variables: z.array(variable).max(100).optional(),
      },
    },
    async ({ collectionId, environmentId, ...patch }) => {
      try {
        return textResult(await workspace.updateEnvironment(collectionId, environmentId, patch))
      } catch (e) {
        return failure(e)
      }
    },
  )
  server.registerTool(
    'delete_environment',
    {
      description: 'Delete one environment identified by ID and revision.',
      annotations: { destructiveHint: true },
      inputSchema: { collectionId: z.string().min(1), environmentId: z.string().min(1), expectedRevision: expected },
    },
    async ({ collectionId, environmentId, expectedRevision }) => {
      try {
        await workspace.deleteEnvironment(collectionId, environmentId, expectedRevision)
        return textResult({ deleted: environmentId })
      } catch (e) {
        return failure(e)
      }
    },
  )
}
