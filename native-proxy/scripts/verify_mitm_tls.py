#!/usr/bin/env python3
"""Focused verified HTTPS proof for the existing Hakka CLI/mitmproxy pipeline."""
import argparse
import json
import traceback
from pathlib import Path

from local_fixtures import Fixtures, SMALL
from proxy_process import ProxyProcess
from verify_proxy import curl


def verify(mitmdump, cli, output, limit):
    output.mkdir(parents=True, exist_ok=True)
    report = {'mode': 'mitm-https-interop', 'status': 'running', 'checks': [],
              'mitmdump': str(mitmdump), 'cli': cli}
    fixtures = None
    proxy = None
    try:
        fixtures = Fixtures(output / 'fixtures')
        proxy = ProxyProcess('mitm', mitmdump, output / 'mitm', fixtures.ca, limit, cli=cli)
        assert proxy.ca and Path(proxy.ca).is_file(), 'Hakka CLI did not expose its public task CA'
        result, elapsed = curl(fixtures.url('/mitm-verified-https', True), proxy)
        assert result.stdout == SMALL, result.stdout
        with fixtures.https.lock:
            assert any(receipt['path'] == '/mitm-verified-https'
                       for receipt in fixtures.https.receipts), 'Verified HTTPS request did not reach the private origin'
        report['checks'].append({'name': 'Curl trusts only the explicit task proxy CA and Hakka verifies the private origin CA',
                                 'status': 'pass', 'elapsedMs': elapsed,
                                 'proxyCAPath': proxy.ca, 'originCAPath': str(fixtures.ca)})
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
        (output / 'mitm-https.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mitmdump', type=Path, required=True)
    parser.add_argument('--cli', nargs='+', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--max-body-bytes', type=int, default=1024)
    args = parser.parse_args()
    result = verify(args.mitmdump.resolve(), args.cli, args.output.resolve(), args.max_body_bytes)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['status'] == 'pass' else 1)
