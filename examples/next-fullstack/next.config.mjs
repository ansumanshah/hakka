/** @type {import('next').NextConfig} */
const nextConfig = {
  // `instrumentation.ts` is enabled by default in Next 15. On Next 13/14, set:
  // experimental: { instrumentationHook: true },

  // hakka-node/next patches node http/https at runtime — keep it AND its
  // runtime chain external so webpack never bundles them for the main
  // server/route compiler: bundling `ws` stubs its optional native deps
  // (bufferutil) to `{}` instead of letting `require()` throw, which breaks
  // `ws.send()` with "bufferUtil.mask/unmask is not a function".
  //
  // NOTE: this alone is NOT sufficient. `instrumentation.ts` is compiled by a
  // separate, dedicated webpack layer that `serverExternalPackages` does not
  // cover, so `ws` still gets bundled on that path (the embedded bridge
  // hub/client are both reached from instrumentation.ts). hakka-node (and its
  // `/next` entry) each carry a `WS_NO_BUFFER_UTIL=1` shim (set before their
  // first `import 'ws'`) as the real fix — it makes `ws` skip the native addon
  // probe entirely, so bundling it can no longer break sends. Keeping the
  // packages external here is still good practice (smaller/faster server
  // bundle) but don't rely on it for this specific failure mode.
  // '@vercel/otel' + its own peers get the same treatment — Next's official
  // OpenTelemetry guide calls this out explicitly for the same class of
  // native/dynamic-require issue `ws` hits above.
  serverExternalPackages: [
    'hakka-node',
    'hakka-bridge',
    'hakka-core',
    'ws',
    '@vercel/otel',
    '@opentelemetry/api',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-metrics',
    '@opentelemetry/sdk-logs',
    '@opentelemetry/api-logs',
    '@opentelemetry/instrumentation',
  ],
}

export default nextConfig
