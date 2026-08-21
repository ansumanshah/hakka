import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLlmsTxt from 'starlight-llms-txt'

const description = 'Local-first network inspector for React Native, the web, Next.js, Android, and iOS.'

export default defineConfig({
  site: 'https://hakka.noodleapps.com',
  redirects: {
    // The contracts-first ADR was published as 0003, colliding with the
    // embeddable-components ADR of the same number. Renumbered to 0009.
    '/contributing/adr/0003-contracts-first-internals': '/contributing/adr/0009-contracts-first-internals/',
  },
  integrations: [
    starlight({
      title: 'Hakka',
      description,
      logo: {
        src: './src/assets/hakka.png',
        alt: 'Hakka',
      },
      favicon: '/favicon.svg',
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://hakka.noodleapps.com/og-hakka.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://hakka.noodleapps.com/og-hakka.png' } },
      ],
      customCss: ['./src/styles/starlight.css'],
      // Code should read as Hakka's own type, on the site's own warm-graphite /
      // paper surfaces — not Expressive Code's default GitHub theme colors.
      // These are CSS var references into starlight.css's --sl-color-gray-*
      // scale, so light/dark stay theme-aware automatically; only the syntax
      // token colors still come from the underlying Shiki theme.
      expressiveCode: {
        styleOverrides: {
          codeFontFamily:
            "ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', 'Droid Sans Mono', Menlo, Monaco, monospace",
          codeFontSize: '0.85rem',
          codeLineHeight: '1.65',
          codePaddingBlock: '1rem',
          codePaddingInline: '1.25rem',
          borderRadius: '10px',
          borderColor: 'var(--sl-color-gray-5)',
          codeBackground: 'var(--sl-color-gray-6)',
          codeForeground: 'var(--sl-color-gray-1)',
        },
      },
      disable404Route: true,
      editLink: {
        baseUrl: 'https://github.com/ansumanshah/hakka/edit/main/docs/',
      },
      lastUpdated: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
      },
      plugins: [
        starlightLlmsTxt({
          projectName: 'Hakka',
          description,
          details:
            'Use these docs to install Hakka in React Native, the web, Next.js, Android, or iOS, understand the shared hakka-core capture engine and record contract, and use the breakpoints, mocking, bridge, MCP, and testing tooling. Hakka captures traffic in-process (no proxy, no certificate) and does not upload it by default.',
          promote: [
            'index*',
            'getting-started/**',
            'core/**',
            'react-native/**',
            'android/**',
            'ios/**',
            'web/**',
            'nextjs/**',
            'features/**',
            'guides/**',
            'cli/**',
            'bridge/**',
            'mcp/**',
            'testing/**',
            'spec/**',
          ],
          customSets: [
            {
              label: 'React Native integration',
              description: 'React Native package, Expo/dev-build guidance, and capture-mode docs for Hakka.',
              paths: ['react-native/**'],
            },
            {
              label: 'Native SDK integration',
              description: 'Android and iOS native SDK integration docs for Hakka.',
              paths: ['android/**', 'ios/**'],
            },
            {
              label: 'Web & Next.js integration',
              description: 'Browser overlay, Vite plugin, and full-stack Next.js capture docs for Hakka.',
              paths: ['web/**', 'nextjs/**'],
            },
            {
              label: 'Engine & tooling',
              description:
                'The hakka-core engine, breakpoints, mocking, the desktop bridge, the MCP server, the CLI, and test helpers.',
              paths: ['core/**', 'features/**', 'bridge/**', 'mcp/**', 'cli/**', 'testing/**'],
            },
            {
              label: 'Capability spec cards',
              description:
                'Per-capability contract cards — public API, config defaults, platform matrix, wire format, and test anchors for capture, mocking, breakpoints, throttle, search, export, retention, redaction, the bridge, control channel, plugins, storage, and theming.',
              paths: ['spec/**'],
            },
          ],
          rawContent: true,
        }),
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/ansumanshah/hakka',
        },
      ],
      sidebar: [
        {
          label: 'Start',
          items: ['getting-started/overview', 'getting-started/install'],
        },
        {
          label: 'React Native',
          items: ['react-native/package', 'react-native/capture-modes', 'react-native/expo'],
        },
        {
          label: 'Web',
          items: ['web/overview', 'web/vite'],
        },
        {
          label: 'Server',
          items: ['nextjs/overview', 'node/overview'],
        },
        {
          label: 'Native SDKs',
          items: ['android/sdk', 'ios/sdk'],
        },
        {
          label: 'Features',
          items: ['features/breakpoints', 'features/mocking'],
        },
        {
          label: 'Guides',
          items: [
            'guides/production-safety',
            'guides/msw',
            'guides/playwright',
            'guides/plugins',
            'guides/react-native-webview',
            'guides/build-your-own-devtools',
          ],
        },
        {
          label: 'Core',
          collapsed: true,
          items: ['core/overview'],
        },
        {
          label: 'Tooling',
          collapsed: true,
          items: [
            'cli/overview',
            'bridge/overview',
            'mcp/overview',
            'testing/overview',
            'cdp/overview',
            'desktop/overview',
            'desktop/api-client',
            'desktop/inspector',
            'desktop/trace',
            'desktop/rules',
          ],
        },
        {
          label: 'Embedding',
          collapsed: true,
          items: ['embedding/components', 'embedding/react', 'embedding/rozenite'],
        },
        {
          label: 'Concepts',
          collapsed: true,
          items: [
            'concepts/architecture',
            'concepts/performance',
            'concepts/capture-scope',
            'concepts/trace-correlation',
            'concepts/url-parsing',
          ],
        },
        {
          label: 'Spec',
          collapsed: true,
          items: [
            'spec/capture',
            'spec/websocket',
            'spec/resilience',
            'spec/graphql',
            'spec/trace',
            'spec/mock',
            'spec/breakpoints',
            'spec/throttle',
            'spec/search-dsl',
            'spec/export',
            'spec/retention',
            'spec/redaction',
            'spec/share-scrubbing',
            'spec/bridge',
            'spec/control-channel',
            'spec/plugins',
            'spec/storage',
            'spec/theming',
            'spec/triggers',
            'spec/sessions',
          ],
        },
        {
          label: 'Reference',
          collapsed: true,
          items: ['reference/comparison', 'reference/benchmarks', 'reference/security', 'reference/plugin-api'],
        },
        {
          label: 'Contributing',
          collapsed: true,
          items: [
            'contributing/architecture',
            'contributing/design-principles',
            'contributing/sdk-design',
            'contributing/decisions',
            'contributing/build-pipeline',
            {
              label: 'ADRs',
              collapsed: true,
              items: [
                'contributing/adr',
                'contributing/adr/0001-cross-target-trace-correlation',
                'contributing/adr/0002-production-capture-cohort',
                'contributing/adr/0003-embeddable-components',
                'contributing/adr/0004-remote-sessions',
                'contributing/adr/0005-package-consolidation',
                'contributing/adr/0006-capture-source-contract',
                'contributing/adr/0007-solid-2-rc',
                'contributing/adr/0008-desktop-plugin-products',
                'contributing/adr/0009-contracts-first-internals',
              ],
            },
          ],
        },
        {
          label: 'Release',
          collapsed: true,
          items: ['release/checklist'],
        },
      ],
    }),
  ],
})
