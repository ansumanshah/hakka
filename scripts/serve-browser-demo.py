"""Serve root examples and package fixtures for local browser demos and E2E."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from socketserver import TCPServer
import sys


class DemoHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Existing test/benchmark fixtures retain their package-relative URLs.
        if path.startswith(("/e2e/", "/dist/")):
            path = "/packages/hakka-browser" + path
        return super().translate_path(path)


class DemoServer(ThreadingHTTPServer):
    # Parallel browser engines open module connections in bursts.
    request_queue_size = 128

    def server_bind(self):
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    handler = partial(DemoHandler, directory=str(root))
    DemoServer(("127.0.0.1", port), handler).serve_forever()
