#!/usr/bin/env python3
"""Actual loopback transport/capture acceptance; never installs or trusts certificates globally."""
import argparse
import hashlib
import json
import socket
import stat
import subprocess
import time
import traceback
from pathlib import Path
from urllib.parse import urlsplit

from local_fixtures import Fixtures, LARGE, SMALL
from proxy_process import ProxyProcess


def curl(url, proxy=None, body=None, origin_ca=None, allow_failure=False):
    command = ['curl', '--silent', '--show-error', '--max-time', '12', '--noproxy', '',
               '--http1.1', '-H', 'Connection: close']
    if proxy:
        command += ['--proxy', f'http://127.0.0.1:{proxy.port}']
    else:
        command += ['--proxy', '']
    if proxy and proxy.ca:
        command += ['--cacert', str(proxy.ca)]
    elif origin_ca:
        command += ['--cacert', str(origin_ca)]
    if body is not None:
        command += ['--data-binary', '@-']
    command += [url]
    started = time.perf_counter()
    result = subprocess.run(command, input=body, capture_output=True)
    elapsed = (time.perf_counter() - started) * 1000
    if not allow_failure and result.returncode:
        raise AssertionError(result.stderr.decode(errors='replace'))
    return result, elapsed


def exchange(port, data, shutdown=False):
    with socket.create_connection(('127.0.0.1', port), timeout=5) as sock:
        sock.sendall(data)
        if shutdown:
            sock.shutdown(socket.SHUT_WR)
        chunks = []
        while True:
            try:
                part = sock.recv(65536)
            except ConnectionResetError:
                break
            if not part:
                break
            chunks.append(part)
        return b''.join(chunks)


def flow_for(proxy, path):
    expected_path = path[:-1] if path.endswith('?') else path
    def matches(item):
        if item.get('type') != 'flow':
            return False
        url = item.get('url', '')
        parts = urlsplit(url)
        return parts.path == expected_path and (not path.endswith('?') or '?' in url)
    return proxy.wait(matches)


def verify(executable, directory, limit):
    fixtures = Fixtures(directory)
    report = {'mode': 'behavior', 'checks': [], 'status': 'running'}
    proxy = None
    def check(name, action):
        action()
        report['checks'].append({'name': name, 'status': 'pass'})
    try:
        proxy = ProxyProcess('native', executable, directory / 'native', fixtures.ca, limit)
        def get(tls):
            path = '/get-https' if tls else '/get-http'
            result, _ = curl(fixtures.url(path, tls), proxy)
            assert result.stdout == SMALL
            flow = flow_for(proxy, path)
            assert flow['status'] == 200 and flow['responseBodySize'] == len(SMALL), flow
            assert [h['value'] for h in flow['responseHeaders'] if h['name'].lower() == 'x-repeated'] == ['one', 'two']
        check('HTTP GET and duplicate response headers', lambda: get(False))
        check('HTTPS verified origin and explicit client trust', lambda: get(True))
        def interim_response():
            result, _ = curl(fixtures.url('/early-hints'), proxy)
            assert result.stdout == SMALL, result.stdout
            flow = flow_for(proxy, '/early-hints')
            assert flow['status'] == 200 and flow['responseBodySize'] == len(SMALL), flow
        check('103 Early Hints followed by complete final response', interim_response)
        def chunked_response():
            result, _ = curl(fixtures.url('/chunked-response'), proxy)
            assert result.stdout == SMALL, result.stdout
            flow = flow_for(proxy, '/chunked-response')
            assert flow['status'] == 200 and flow['responseBodySize'] == len(SMALL), flow
            assert flow['responseBody'] == SMALL.decode(), flow
        check('Unknown-length chunked response forwarding and capture', chunked_response)
        def redaction():
            body = b'{"password":"body-secret","nested":{"token":"nested-secret"},"ordinary":"visible"}'
            command = ['curl', '--silent', '--show-error', '--max-time', '12', '--noproxy', '',
                       '--proxy', f'http://127.0.0.1:{proxy.port}', '-H', 'Connection: close',
                       '-H', 'Content-Type: application/json', '-H', 'Authorization: Bearer header-secret',
                       '--data-binary', '@-', fixtures.url('/json?token=query-secret&ordinary=visible')]
            result = subprocess.run(command, input=body, capture_output=True, check=True)
            assert result.stdout == body, 'Redaction modified the forwarded payload'
            receipt = fixtures.http.receipts[-1]
            assert receipt['authorization'] == 'Bearer header-secret'
            flow = flow_for(proxy, '/json?')
            encoded = json.dumps(flow)
            for secret in ['body-secret', 'nested-secret', 'header-secret', 'query-secret', 'response-secret', 'second-secret']:
                assert secret not in encoded, f'Captured secret: {secret}'
            assert 'visible' in encoded and flow['requestBodySize'] == len(body)
        check('Header, nested JSON, response cookie and URL query redaction before capture', redaction)
        def large():
            result, _ = curl(fixtures.url('/large-download'), proxy)
            assert hashlib.sha256(result.stdout).digest() == hashlib.sha256(LARGE).digest()
            flow = flow_for(proxy, '/large-download')
            assert flow['responseBodySize'] == len(LARGE) and flow['responseBodyTruncated']
            assert len((flow.get('responseBody') or '').encode()) <= limit
            result, _ = curl(fixtures.url('/echo-upload'), proxy, LARGE)
            assert result.stdout == LARGE
            flow = flow_for(proxy, '/echo-upload')
            assert flow['requestBodySize'] == len(LARGE) and flow['requestBodyTruncated']
            assert len((flow.get('requestBody') or '').encode()) <= limit
        check('Streamed 2 MiB upload/download byte identity and bounded capture', large)
        def chunked():
            authority = f'127.0.0.1:{fixtures.http.server_port}'
            request = (f'POST http://{authority}/chunked HTTP/1.1\r\nHost: {authority}\r\n'
                       'Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n').encode()
            response = exchange(proxy.port, request + b'5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n')
            assert b'200 OK' in response and response.endswith(b'hello world'), response
            assert flow_for(proxy, '/chunked')['requestBodySize'] == 11
        check('Chunked request forwarding', chunked)
        def malformed():
            for target in ['http://user:password@127.0.0.1:1/reject', 'ftp://127.0.0.1/reject']:
                response = exchange(proxy.port, f'GET {target} HTTP/1.1\r\nHost: invalid\r\nConnection: close\r\n\r\n'.encode())
                assert response.startswith(b'HTTP/1.1 4') or response.startswith(b'HTTP/1.1 5'), response
        check('Credential authority and unsupported scheme rejected', malformed)
        def rejection():
            # New, unrelated CA exercises verification failure without -k or ssl_insecure.
            other = Fixtures(directory / 'untrusted')
            try:
                result, _ = curl(other.url('/untrusted-origin', True), proxy, allow_failure=True)
                assert result.stdout != SMALL, 'Untrusted upstream unexpectedly forwarded'
                flow = flow_for(proxy, '/untrusted-origin')
                assert flow.get('error'), flow
            finally:
                other.close()
        check('Untrusted upstream TLS rejects traffic', rejection)
        def wrong_san():
            url = f'https://127.0.0.1:{fixtures.wrong_san.server_port}/wrong-san'
            result, _ = curl(url, proxy, allow_failure=True)
            assert result.stdout != SMALL, 'Trusted-chain certificate with wrong IP SAN was accepted'
            flow = flow_for(proxy, '/wrong-san')
            assert flow.get('error'), flow
        check('Trusted upstream CA with mismatched IP SAN rejects HTTPS', wrong_san)
        def exclusive_ca_owner():
            ca_dir = proxy.directory / 'proxy-ca'
            assert stat.S_IMODE(ca_dir.stat().st_mode) == 0o700
            assert stat.S_IMODE((ca_dir / 'ca-key.pem').stat().st_mode) == 0o600
            command = [str(executable), '--host', '127.0.0.1', '--port', '0',
                       '--max-body-bytes', str(limit), '--ca-dir', str(ca_dir),
                       '--upstream-ca', str(fixtures.ca)]
            second = subprocess.run(command, capture_output=True, text=True, timeout=10)
            assert second.returncode != 0, 'Second engine acquired a CA directory already owned by the live engine'
            assert not any(json.loads(line).get('type') == 'ready'
                           for line in second.stdout.splitlines() if line.startswith('{'))
            assert proxy.process.poll() is None, 'Second engine affected the existing CA owner'
            result, _ = curl(fixtures.url('/owner-still-live'), proxy)
            assert result.stdout == SMALL
        check('Private CA file modes and exclusive live directory ownership', exclusive_ca_owner)
        def cancellation():
            client = socket.create_connection(('127.0.0.1', proxy.port), timeout=5)
            url = fixtures.url('/slow-cancellation')
            client.sendall(f'GET {url} HTTP/1.1\r\nHost: 127.0.0.1:{fixtures.http.server_port}\r\n'
                           'Connection: close\r\n\r\n'.encode())
            try:
                # Do not count an immediate SIGTERM as cancellation of an active
                # request: wait until the origin has accepted it and entered its
                # deliberate delay before stopping the proxy.
                deadline = time.monotonic() + 5
                while True:
                    with fixtures.http.lock:
                        received = any(receipt['path'] == '/slow-cancellation'
                                       for receipt in fixtures.http.receipts)
                    if received:
                        break
                    if time.monotonic() >= deadline:
                        raise AssertionError('Slow origin did not receive cancellation request')
                    time.sleep(.01)
                report['metrics'] = proxy.close()
            finally:
                client.close()
        check('SIGTERM with in-flight origin and released listening port', cancellation)
        proxy = None
        tunnel = ProxyProcess('native', executable, directory / 'tunnel', None, limit)
        try:
            def connect():
                with socket.create_connection(('127.0.0.1', tunnel.port), timeout=5) as sock:
                    authority = f'127.0.0.1:{fixtures.echo.server_address[1]}'
                    sock.sendall(f'CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n'.encode() + b'buffered-hello')
                    data = b''
                    while b'\r\n\r\n' not in data:
                        data += sock.recv(4096)
                    head, data = data.split(b'\r\n\r\n', 1)
                    assert b'200' in head
                    while len(data) < len(b'buffered-hello'):
                        data += sock.recv(4096)
                    assert data == b'buffered-hello', data
                    sock.shutdown(socket.SHUT_WR)
                    tail = b''
                    while True:
                        part = sock.recv(4096)
                        if not part:
                            break
                        tail += part
                    assert tail == b'EOF', tail
            check('CONNECT tunnel preserves coalesced bytes and client half-close', connect)
        finally:
            tunnel.close()
        report['status'] = 'pass'
    except Exception as error:
        report['status'] = 'fail'
        report['error'] = str(error)
        report['traceback'] = traceback.format_exc()
    finally:
        if proxy:
            proxy.close(require_clean=False)
        fixtures.close()
        (directory / 'behavior.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--max-body-bytes', type=int, default=1024)
    args = parser.parse_args()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    report = verify(args.native.resolve(), args.output, args.max_body_bytes)
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['status'] == 'pass' else 1)
