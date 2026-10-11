# Private transport verification and matched measurement

These scripts use real loopback HTTP/HTTPS origins and explicit curl proxy/CA options. They never install a CA, change system proxy settings, or mutate a simulator/device. Certificates and proxy configuration live under the chosen fresh output directory. Only Python's standard library, existing curl/OpenSSL, the already-built native executable, and (for comparison) an existing Hakka CLI + mitmdump are used. No dependency installation occurs.

Run from the Hakka checkout after the owning build/test gate. Use a fresh output path each time. Do not run measurements alongside other builds, indexers, tests, or benchmarks. Existing repository benchmarks are untouched.

```sh
python3 native-proxy/scripts/verify_proxy.py \
  --native "$PWD/native-proxy/.build/release/hakka-native-proxy" \
  --output "$PWD/artifacts/native-proxy-behavior"

python3 native-proxy/scripts/benchmark_proxy.py \
  --native "$PWD/native-proxy/.build/release/hakka-native-proxy" \
  --mitmdump /Users/ansumanshah/Code/hakka/artifacts/proxy-workspace-20261003/venv/bin/mitmdump \
  --build-type release --samples 30 --rounds 3 --warmup 3 --concurrency 4 \
  --output "$PWD/artifacts/native-proxy-matched"
```

The comparison defaults to Bun calling the existing `runProxyCommand` implementation through a minimal source entrypoint. If the packaged CLI is already built, append `--cli bun /absolute/path/to/packages/hakka-cli/dist/cli.mjs` as the last option. This captures the real CLI mapper/store/export and the mitmdump descendant rather than a language microbenchmark. No live breakpoint, script, routing-rule or bandwidth bridge is enabled.

`behavior.json` records actual GET/POST byte delivery, duplicate response headers, redaction before native JSONL capture, large upload/download bounds, chunked upload, unsupported scheme/credential authority rejection, upstream TLS rejection, shutdown during an active request, released listener, buffered CONNECT bytes and half-close. Any first failure stops the suite and includes an error; later checks remain untested. The Swift configuration test is a narrow resource/loopback validation gate, separate from these runtime checks.

`benchmark.json` records curl wall-time samples and interpolated p50/p95/p99, payload hashes, exact origin delivery count, completed capture count/IDs/body bounds/cookie redaction, startup to readiness, aggregate process-tree CPU time and sampled peak/baseline RSS. HTTP/HTTPS, small/2 MiB, sequential/concurrent workloads use identical `Connection: close` requests. This measures fresh connections; native keep-alive/pooling is deferred and mitmproxy's pooling capability is outside this comparison. Direct/proxy engine order is shuffled reproducibly per round; warmups are separate. Large bodies must be delivered intact and capture previews stay bounded. Origin TLS remains verified in both engines via the fixture CA; clients trust only the supplied task CA. CLI uses the private `ssl_verify_upstream_trusted_ca` config setting.

Limits: curl launch overhead is included for every engine; percentile differences are differences between distributions, not paired per-request overhead. Small sample counts make p99 exploratory. RSS sums can double-count shared pages, and 50 ms `ps` samples can miss short peaks/short-lived descendants; CPU precision comes from `ps`. Startup includes fresh local CA generation. Metrics missing from process observation remain null. A missing mitmdump produces `partial` with an unavailable entry, never a zero-valued comparison. A failed engine remains failed even when its transport timings were collected. This evidence does not establish a package, signing, device, hosted CI, or release gate.
