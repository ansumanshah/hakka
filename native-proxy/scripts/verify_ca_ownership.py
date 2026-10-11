#!/usr/bin/env python3
"""Focused proof that a live proxy exclusively owns its private task CA directory."""
import argparse
import hashlib
import json
import stat
import subprocess
import traceback
from pathlib import Path

from local_fixtures import Fixtures, SMALL
from proxy_process import ProxyProcess
from verify_proxy import curl


def verify(executable, output):
    output.mkdir(parents=True, exist_ok=True)
    report = {'mode': 'ca-ownership', 'status': 'running', 'checks': [],
              'nativeSHA256': hashlib.sha256(executable.read_bytes()).hexdigest()}
    fixtures = None
    proxy = None
    try:
        fixtures = Fixtures(output)
        proxy = ProxyProcess('native', executable, output / 'owner', fixtures.ca, 1024)
        ca_dir = output / 'owner' / 'proxy-ca'
        assert stat.S_IMODE(ca_dir.stat().st_mode) == 0o700
        assert stat.S_IMODE((ca_dir / 'ca-key.pem').stat().st_mode) == 0o600
        report['checks'].append({'name': 'CA directory mode 0700 and private key mode 0600', 'status': 'pass'})

        command = [str(executable), '--host', '127.0.0.1', '--port', '0',
                   '--max-body-bytes', '1024', '--ca-dir', str(ca_dir),
                   '--upstream-ca', str(fixtures.ca)]
        second = subprocess.run(command, capture_output=True, text=True, timeout=10)
        assert second.returncode != 0, 'Second engine acquired a CA directory already owned by the live engine'
        events = [json.loads(line) for line in second.stdout.splitlines() if line.startswith('{')]
        assert not any(event.get('type') == 'ready' for event in events), events
        assert 'ca-key.pem' not in second.stderr and 'BEGIN PRIVATE KEY' not in second.stderr
        assert proxy.process.poll() is None, 'Second engine affected the existing CA owner'
        report['checks'].append({'name': 'Second engine rejected while first process owns the CA directory', 'status': 'pass'})

        result, _ = curl(fixtures.url('/ca-owner-https', True), proxy)
        assert result.stdout == SMALL, result.stdout
        flow = proxy.wait(lambda event: event.get('type') == 'flow'
                          and event.get('url', '').endswith('/ca-owner-https'))
        assert flow.get('status') == 200 and not flow.get('error'), flow
        report['checks'].append({'name': 'First owner still completes verified HTTPS through its private CA', 'status': 'pass'})
        report['metrics'] = proxy.close()
        proxy = None
        report['status'] = 'pass'
    except Exception as error:
        report.update({'status': 'fail', 'error': str(error), 'traceback': traceback.format_exc()})
    finally:
        if proxy:
            proxy.close(require_clean=False)
        if fixtures:
            fixtures.close()
        (output / 'ca-ownership.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.native.resolve(), args.output.resolve())
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['status'] == 'pass' else 1)
