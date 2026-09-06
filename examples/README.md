# Hakka examples

Runnable demos and integration examples live here; SDK source stays under `packages/`.
Build the SDK packages first with `bun run build` from the repository root.

| Example                                             | Purpose                                        | Run                                                  |
| --------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| [browser-demo](browser-demo/)                       | Plain HTML inspector and worker capture        | `just demo-browser`                                  |
| [build-your-own-devtools](build-your-own-devtools/) | Custom elements and React inspector panels     | `just demo-devtools-panel`                           |
| [vite-app](vite-app/)                               | Vite plugin integration                        | `npm install && npm run dev` in its folder           |
| [webpack-probe](webpack-probe/)                     | Webpack injection probe                        | `npm install && npm run build` in its folder         |
| [react-native-example](react-native-example/)       | Native iOS/Android inspector in React Native   | `just dev-ios` / `just dev-android`                  |
| [expo-example](expo-example/)                       | Expo development client                        | Follow its README                                    |
| [rozenite](rozenite/)                               | DevTools panel verification and sample traffic | Follow its README                                    |
| [next-fullstack](next-fullstack/)                   | Next.js server and browser capture             | Follow its README                                    |
| [framework-servers](framework-servers/)             | HTTP, Express, Fastify, Hono, and Bun servers  | `npm install && npm run demo` in its folder          |
| [otel-spans](otel-spans/)                           | OpenTelemetry integration                      | `npm install && npm run demo` in its folder          |
| [prod-cohort](prod-cohort/)                         | Opt-in production cohort capture               | `npm install && npm run demo` in its folder          |
| [ci-gate](ci-gate/)                                 | Traffic assertions and baseline checks         | `bun test examples/ci-gate/ciGate.test.ts` from root |
| [cdp-playwright](cdp-playwright/)                   | Browser traffic via CDP                        | `npm install && npm test` in its folder              |
| [claude-code](claude-code/)                         | MCP agent setup                                | Follow its README                                    |

React Native, Expo, and CI-gate are private Bun workspaces installed by the root
`bun install`. The other app examples intentionally use their own npm installs to
exercise package consumption through local `file:` dependencies. See each README
for platform prerequisites and additional setup.
