"""Serve root examples and package fixtures for local browser demos and E2E."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys


class DemoHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Existing test/benchmark fixtures retain their package-relative URLs.
        if path.startswith(("/e2e/", "/dist/")):
            path = "/packages/hakka-browser" + path
        return super().translate_path(path)


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    handler = partial(DemoHandler, directory=str(root))
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
