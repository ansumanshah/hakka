---
title: Collection authoring
description: Author Hakka collection files through MCP.
---

The MCP server can author canonical Hakka collections without sending requests. Set an explicit workspace before starting it:

```sh
HAKKA_WORKSPACE_DIR="$PWD/.hakka-workspace" hakka mcp
```

The workspace is the only location these tools can write. Each collection is a directory containing the version-4 Swift `CollectionStore` format: `collection.hakka` at its root, one `.hakka` request file per request, and `folder.hakka` in each folder. Environments are stored beside collections in `environments/<collection-directory>/`, matching the desktop app.

Use `list_collections`, then `create_collection` or `read_collection`. Collection updates and deletes require the `revision` returned by a read. The same optimistic-concurrency rule applies to `read_folder`/`update_folder`, `read_collection_request`/`update_collection_request`, and environments. A stale revision returns `conflict`; read the item again before retrying.

Create nested nodes with `create_folder` and `create_collection_request`; requests can be placed under `parentFolderId`. `delete_collection_node` accepts an explicit request or folder ID and its revision. All list operations are bounded to 100 items.

For example, create a runnable health check:

```json
{ "name": "create_collection", "arguments": { "name": "Service checks" } }
```

Then pass the returned collection ID to:

```json
{
  "name": "create_collection_request",
  "arguments": { "collectionId": "<id>", "name": "Health", "method": "GET", "url": "{{BASE_URL}}/health" }
}
```

Authoring tools never run or replay requests. Use `run_collection` separately after inspecting the authored request and obtaining authorization, since running it can change remote data.

Environment values use `{name, value, enabled}`. Secret variables are currently rejected by MCP: the desktop app stores them in Keychain entries keyed by the collection path, environment ID, and variable ID, so an arbitrary `secretRef` cannot create an interoperable reference. Add or change secrets in the desktop app, then use MCP only for non-secret environment metadata and values.

Paths, filenames, and symlinks are never accepted from tool arguments. Identifiers are resolved by scanning the configured workspace, and writes use atomic replacement inside real, non-symlink directories.

Literal credentials in authored auth settings and sensitive headers are redacted on reads. Use environment references to keep collection files shareable. Optional `session` input authors finite WebSocket or SSE requests using the same shape as the desktop Session tab.

Revision checks serialize updates made by one MCP process. External desktop or editor writes are not transactionally locked; avoid simultaneous writers to a collection and reread after external edits.
