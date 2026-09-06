# Desktop bridge walkthrough

Run real local traffic through Hakka for macOS, inspect it, and replay it from the
API client. Requires macOS 15+, Swift 6.1+, Node 22+, and the repository's Bun toolchain.
No external API or credentials are needed.

From the repository root:

```bash
bun install --frozen-lockfile
bun run build
cd apps/hakka
./Scripts/package_app.sh debug
open Hakka.app
cd ../..
node examples/desktop-bridge/run.mjs
```

The demo connects to the desktop's existing bridge, sends GET, POST, 503, and slow
requests to an ephemeral localhost server, then checks trace correlation and
credential redaction on records relayed back through the bridge. A `PASS` line
confirms capture and relay; it does not substitute for checking the UI.

1. Open **Live Traffic**. Find the four requests using the localhost URL printed
   by the demo. Select `/echo` to inspect the JSON request and response bodies.
2. Enable **Errors only** to isolate `/error` with status 503, then disable it.
3. Save `/json` to a collection and press **Send** in the API client. The demo
   keeps its server alive so replay works without an external service.
4. Press Ctrl-C in the terminal when finished. Captures remain visible in Hakka;
   replay against the stopped server will fail, as expected.

For a bounded smoke check that closes its server automatically:

```bash
node examples/desktop-bridge/run.mjs --check
```

The default bridge URL is `ws://127.0.0.1:8989`; `HAKKA_BRIDGE_URL` can select a
custom host. A standalone Node hub can also pass the relay check, so open the
Hakka window and verify the requests to prove desktop delivery. Close other hubs
using port 8989 before launching Hakka. The stock desktop app accepts local
connections only; this walkthrough does not enable LAN access.

This example imports the repository's built `hakka-node` entrypoint directly.
For an independent package-consumer installation, use
[`framework-servers`](../framework-servers/) or [`next-fullstack`](../next-fullstack/).
