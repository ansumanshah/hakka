# Hakka proxy capture example

This example captures a plain HTTP request through the optional local mitmproxy sidecar. It does not change your global proxy or install a certificate.

```bash
hakka proxy --port 8080 --map-config ./proxy-mappings.json --har ./capture.har
curl --proxy http://127.0.0.1:8080 http://example.test/config
```

`proxy-mappings.json` maps the URL to `fixtures/config.json`; stop Hakka with Ctrl-C to write the HAR. For HTTPS, use a separate test profile and follow `hakka proxy --cert-help`. Pinned applications cannot be intercepted by this setup.
