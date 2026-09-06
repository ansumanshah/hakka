import Foundation

/// Development-only setup snippets for streaming a web or server runtime to
/// the desktop bridge. Each snippet uses the documented loopback hub instead
/// of starting another bridge in the app process.
enum SetupSnippet {
    enum Target: String, CaseIterable, Identifiable {
        case web
        case node
        case next

        var id: Self {
            self
        }

        var title: String {
            switch self {
            case .web: "Web (Vite)"
            case .node: "Node.js"
            case .next: "Next.js"
            }
        }

        var docsURL: URL {
            switch self {
            case .web: URL(string: "https://hakka.noodleapps.com/web/vite/")!
            case .node: URL(string: "https://hakka.noodleapps.com/node/overview/")!
            case .next: URL(string: "https://hakka.noodleapps.com/nextjs/overview/")!
            }
        }
    }

    static func text(for target: Target) -> String {
        switch target {
        case .web:
            """
            npm install -D hakka-browser

            // Vite: src/main.ts — development only
            if (import.meta.env.DEV) {
              const { start, connect } = await import('hakka-browser')
              start({ overlay: false })
              connect('ws://localhost:8989')
            }
            """
        case .node:
            """
            npm install -D hakka-node

            // server.mjs — before app imports
            if (process.env.NODE_ENV === 'development') {
              const { register } = await import('hakka-node')
              register({
                embedBridge: false,
                bridgeUrl: 'ws://localhost:8989',
              })
            }
            """
        case .next:
            """
            npm install -D hakka-node hakka-browser

            // instrumentation.ts — development only
            export async function register() {
              if (process.env.NODE_ENV !== 'development') return
              const { register: registerHakka } = await import('hakka-node/next')
              await registerHakka({
                embedBridge: false,
                bridgeUrl: 'ws://localhost:8989',
              })
            }

            // instrumentation-client.ts (Next 15.3+)
            import 'hakka-node/next/client'
            """
        }
    }
}
