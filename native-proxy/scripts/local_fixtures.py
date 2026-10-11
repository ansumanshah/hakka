"""Private origins for transport verification. No OS trust or proxy changes."""
import hashlib
import http.server
import json
import socketserver
import ssl
import subprocess
import threading
import time
from pathlib import Path

HOST = '127.0.0.1'
SMALL = b'Hakka private fixture\n'
LARGE = (b'0123456789abcdef' * 131072)  # 2 MiB; known byte identity


def make_ca(directory):
    directory.mkdir(parents=True, exist_ok=True)
    config = directory / 'openssl.cnf'
    config.write_text('[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n'
                      '[dn]\nCN=localhost\n[ext]\nbasicConstraints=critical,CA:TRUE\n'
                      'keyUsage=critical,keyCertSign,digitalSignature,keyEncipherment\n'
                      'subjectAltName=IP:127.0.0.1,DNS:localhost\n')
    cert, key = directory / 'ca.pem', directory / 'key.pem'
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                    '-config', str(config), '-keyout', str(key), '-out', str(cert)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    key.chmod(0o600)
    return cert, key


def make_wrong_san_leaf(directory, ca, ca_key):
    config = directory / 'wrong-san.cnf'
    request, leaf, key = directory / 'wrong-san.csr', directory / 'wrong-san.pem', directory / 'wrong-san-key.pem'
    config.write_text('[req]\ndistinguished_name=dn\nreq_extensions=reqext\nprompt=no\n'
                      '[dn]\nCN=wrong-origin.invalid\n'
                      '[reqext]\nsubjectAltName=DNS:wrong-origin.invalid\n'
                      'basicConstraints=critical,CA:FALSE\n'
                      'keyUsage=critical,digitalSignature,keyEncipherment\n'
                      'extendedKeyUsage=serverAuth\n'
                      '[leaf]\nsubjectAltName=DNS:wrong-origin.invalid\n'
                      'basicConstraints=critical,CA:FALSE\n'
                      'keyUsage=critical,digitalSignature,keyEncipherment\n'
                      'extendedKeyUsage=serverAuth\n')
    subprocess.run(['openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
                    '-config', str(config), '-keyout', str(key), '-out', str(request)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    key.chmod(0o600)
    subprocess.run(['openssl', 'x509', '-req', '-in', str(request), '-CA', str(ca), '-CAkey', str(ca_key),
                    '-set_serial', '0x20261003', '-days', '1', '-sha256', '-extfile', str(config),
                    '-extensions', 'leaf', '-out', str(leaf)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return leaf, key


class Origin(http.server.ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self):
        super().__init__((HOST, 0), Handler)
        self.receipts = []
        self.lock = threading.Lock()


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_):
        pass
    def do_GET(self):
        self.respond(b'')
    def do_POST(self):
        if self.headers.get('Transfer-Encoding', '').lower() == 'chunked':
            chunks = []
            while True:
                size = int(self.rfile.readline().strip().split(b';')[0], 16)
                if not size:
                    while self.rfile.readline() != b'\r\n':
                        pass
                    break
                chunks.append(self.rfile.read(size))
                assert self.rfile.read(2) == b'\r\n'
            body = b''.join(chunks)
        else:
            body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        self.respond(body)
    def respond(self, body):
        with self.server.lock:
            self.server.receipts.append({'path': self.path, 'method': self.command,
                                        'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest(),
                                        'authorization': self.headers.get('Authorization')})
        if self.path.startswith('/slow'):
            time.sleep(3)
        payload = LARGE if self.path.startswith('/large') else body if self.command == 'POST' else SMALL
        if self.path.startswith('/early-hints'):
            self.send_response_only(103, 'Early Hints')
            self.send_header('Link', '</style.css>; rel=preload; as=style')
            self.end_headers()
        chunked = self.path.startswith('/chunked-response')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json' if self.path.startswith('/json') else 'text/plain')
        if chunked:
            self.send_header('Transfer-Encoding', 'chunked')
        else:
            self.send_header('Content-Length', str(len(payload)))
        self.send_header('X-Repeated', 'one')
        self.send_header('X-Repeated', 'two')
        self.send_header('Set-Cookie', 'session=response-secret; HttpOnly')
        self.send_header('Set-Cookie', 'other=second-secret; HttpOnly')
        self.send_header('Connection', 'close')
        self.end_headers()
        try:
            for offset in range(0, len(payload), 8192):
                part = payload[offset:offset + 8192]
                if chunked:
                    self.wfile.write(f'{len(part):x}\r\n'.encode() + part + b'\r\n')
                else:
                    self.wfile.write(part)
                self.wfile.flush()
            if chunked:
                self.wfile.write(b'0\r\n\r\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
            pass
        self.close_connection = True


class Echo(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class EchoHandler(socketserver.BaseRequestHandler):
    def handle(self):
        while True:
            data = self.request.recv(65536)
            if not data:
                self.request.sendall(b'EOF')
                self.request.shutdown(1)
                return
            self.request.sendall(data)


class Fixtures:
    def __init__(self, directory):
        self.ca, key = make_ca(directory / 'origin')
        self.http, self.https = Origin(), Origin()
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.ca, key)
        self.https.socket = context.wrap_socket(self.https.socket, server_side=True)
        wrong_cert, wrong_key = make_wrong_san_leaf(directory / 'origin', self.ca, key)
        self.wrong_san = Origin()
        wrong_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        wrong_context.load_cert_chain(wrong_cert, wrong_key)
        self.wrong_san.socket = wrong_context.wrap_socket(self.wrong_san.socket, server_side=True)
        self.echo = Echo((HOST, 0), EchoHandler)
        for server in [self.http, self.https, self.wrong_san, self.echo]:
            threading.Thread(target=server.serve_forever, daemon=True).start()
    def url(self, path, tls=False):
        origin = self.https if tls else self.http
        return f'{"https" if tls else "http"}://{HOST}:{origin.server_port}{path}'
    def close(self):
        for server in [self.http, self.https, self.wrong_san, self.echo]:
            server.shutdown()
            server.server_close()
