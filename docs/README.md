# Hakka Docs Site

Astro + Starlight site for [Hakka](https://github.com/ansumanshah/hakka) — the local-first network inspector for React Native, the web, Next.js, Android, and iOS.

## Dev

```bash
bun run docs:dev      # http://localhost:4321
bun run docs:build    # output → docs/dist/
bun run docs:preview  # serve built output locally
```

Run all commands from the repository root.

## Structure

```
docs/
└── src/content/docs/
    ├── getting-started/  # Installation, quickstart
    ├── react-native/     # RN + Expo integration guides
    ├── web/               # Browser overlay, Vite plugin
    ├── nextjs/            # Full-stack Next.js capture
    ├── android/           # Kotlin/Gradle integration
    ├── ios/               # Swift Package Manager integration
    ├── node/              # Node server capture (Express/Fastify/Hono/raw http)
    ├── cdp/               # Chrome DevTools Protocol capture
    ├── embedding/         # hakka-browser/elements + hakka-browser/react standalone pieces
    ├── features/          # Breakpoints, mocking
    ├── guides/            # Production safety, MSW, plugins, WebView, build-your-own-devtools
    ├── core/              # hakka-core engine
    ├── cli/               # hakka CLI
    ├── bridge/            # hakka-bridge desktop hub
    ├── mcp/               # MCP server
    ├── testing/           # hakka-core/test helpers
    ├── concepts/          # Capture modes, architecture, performance, trace correlation
    ├── spec/              # Per-capability contract cards (capture, mock, breakpoints, ...)
    ├── reference/         # Comparison, benchmarks, security, plugin API
    ├── contributing/      # Architecture, design principles, SDK design, decisions
    └── release/           # Changelog, versioning
```

Add an entry to `docs/astro.config.mjs`'s `sidebar` array whenever a section's page list changes — the sidebar does not auto-discover pages.

## Adding a Page

1. Create `src/content/docs/<section>/your-page.md` (or `.mdx`) with front matter:
   ```md
   ---
   title: Your Page Title
   description: One-line description.
   ---
   ```
2. Add an entry to the matching sidebar group in `docs/astro.config.mjs`.

## LLM Outputs

The `starlight-llms-txt` plugin generates agent-readable entrypoints from the same Markdown source, at build time:

- `/llms.txt` — index of all promoted pages
- `/llms-full.txt` — full content of all promoted pages
- `/llms-small.txt` — condensed version
- `/_llms-txt/react-native-integration.txt` — `react-native/**`
- `/_llms-txt/native-sdk-integration.txt` — `android/**`, `ios/**`
- `/_llms-txt/web--nextjs-integration.txt` — `web/**`, `nextjs/**`
- `/_llms-txt/engine--tooling.txt` — `core/**`, `features/**`, `bridge/**`, `mcp/**`, `cli/**`, `testing/**`
- `/_llms-txt/capability-spec-cards.txt` — `spec/**`

Each entry's label (in `astro.config.mjs`'s `customSets`) becomes its path slug via
`github-slugger` — `&` is stripped, not replaced with a word, so "Web & Next.js
integration" slugs to `web--nextjs-integration` (double hyphen).

Which sections are promoted into the general `llms.txt`/`llms-full.txt` set, and which paths back each custom set above, is defined in `docs/astro.config.mjs`'s `starlightLlmsTxt({ promote, customSets })` config — check there before adding a new top-level section, since a new section needs an explicit `promote` entry (and usually a `customSets` entry) to show up in any LLM output.

## Ignore

Do not commit generated output or local caches:

- `docs/dist/`
- `docs/.astro/`
- `docs/node_modules/`
