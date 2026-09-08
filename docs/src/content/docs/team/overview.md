---
title: Team workspaces
description: Self-hosted collection snapshots, reviewable synchronization, and scheduled collection monitors.
---

`hakka team` is a local-first service for sharing canonical Hakka collection files between a small team. It has no hosted account, public endpoint, or cloud deployment path. The service persists workspace revisions, member roles, hashed access tokens, monitor schedules, and run history in a local data file.

Start it on the same machine as a reverse proxy:

```sh
hakka team serve --data /srv/hakka/team-state.json --bind 127.0.0.1 --port 7137 --token "$HAKKA_TEAM_BOOTSTRAP_TOKEN"
```

The token is required for non-loopback bindings. Keep it in a secret manager or protected environment variable; it is shown only once when omitted. Put TLS, authentication policy, request-size limits, and network access control at the reverse proxy. Do not expose the service directly to the internet. The service also requires a bearer token on every API endpoint; `/healthz` is the only unauthenticated readiness route.

An administrator creates scoped tokens with `POST /api/v1/tokens`. `read` can fetch snapshots, `write` can replace snapshots using their exact revision, and `admin` manages tokens and monitors. Tokens are stored as SHA-256 hashes, so retain the original token when it is issued.

Synchronize a collection directory explicitly:

```sh
hakka team push ./payments --url https://hakka.internal --token "$HAKKA_TEAM_TOKEN"
hakka team pull ./payments --url https://hakka.internal --token "$HAKKA_TEAM_TOKEN"
```

Push reads only `.hakka` and `.json` files under the canonical collection directory, excludes `.hakka/team-sync.json`, rejects symlinks and path escapes, and sends the saved remote revision. Repeating a push uses the revision returned by the prior push. A stale push stops with an error; pull, inspect and merge the files, then push again.

Pull uses the saved snapshot as a merge base. It fast-forwards files that are unchanged locally, preserves local edits when the corresponding remote file is unchanged, and accepts matching local and remote edits. If both sides changed the same file differently, it reports a conflict before changing any collection file or the saved base revision.

Monitors are durable schedules stored by the service. They run a collection snapshot with a finite whole-run deadline, disable request hooks for every remotely supplied snapshot, and never overlap their own previous run. Shutdown cancels and waits for active runs. On restart, an interrupted run becomes immediately due. A secret-bearing monitor pins the collection revision that an administrator approved when creating it. Store variables separately as protected secret references and configure a webhook only for an endpoint you control. Notification payloads contain a monitor ID, outcome, and aggregate counts; they omit collection contents and secret values. Webhook delivery has a short bounded retry policy.

For production, run the process as a dedicated OS user, keep the data directory mode `0700`, back up the data file securely, and terminate TLS at a maintained reverse proxy. Configure firewall rules so only that proxy can reach the loopback service.
