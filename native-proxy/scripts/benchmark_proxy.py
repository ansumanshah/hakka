#!/usr/bin/env python3
"""Matched real proxy client workloads; records unavailable gates rather than fabricated numbers."""
import argparse
import concurrent.futures
import hashlib
import json
import platform
import random
import shutil
import subprocess
import time
import traceback
from pathlib import Path

from local_fixtures import Fixtures, LARGE, SMALL
from proxy_process import ProxyProcess
from verify_proxy import curl

ROOT = Path(__file__).resolve().parents[2]


def version(command):
    try:
        result = subprocess.run(command, text=True, capture_output=True, timeout=10)
        return (result.stdout or result.stderr).strip() if result.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * fraction
    lower = int(index)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)


def summarize(values):
    return {'count': len(values), 'p50Ms': percentile(values, .5),
            'p95Ms': percentile(values, .95), 'p99Ms': percentile(values, .99), 'samplesMs': values}


def records(proxy):
    if proxy.engine == 'native':
        return proxy.flows()
    return json.loads(proxy.session_path.read_text())['requests']


def run_workload(fixtures, proxy, count, concurrency, tls, large, prefix):
    expected = LARGE if large else SMALL
    payload_hash = hashlib.sha256(expected).hexdigest()
    urls = [fixtures.url(f'/{"large" if large else "small"}-{prefix}-{index}', tls) for index in range(count)]
    server = fixtures.https if tls else fixtures.http
    before = len(server.receipts)
    started = time.perf_counter()
    def request(url):
        result, elapsed = curl(url, proxy, origin_ca=fixtures.ca)
        assert hashlib.sha256(result.stdout).hexdigest() == payload_hash, 'Payload differs'
        return elapsed
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        timings = list(pool.map(request, urls))
    elapsed = time.perf_counter() - started
    delivered = server.receipts[before:]
    assert len(delivered) == count, f'Expected {count} deliveries, got {len(delivered)}'
    assert {receipt['path'] for receipt in delivered} == {'/' + url.split('/', 3)[3] for url in urls}
    return {**summarize(timings), 'wallSeconds': elapsed, 'throughputRequestsPerSecond': count / elapsed,
            'expectedPayloadSHA256': payload_hash, 'expectedPayloadBytes': len(expected),
            'verifiedDeliveryCount': len(delivered), 'capturePrefix': prefix}


def verify_capture(proxy, workloads, limit):
    captured = records(proxy)
    for workload in workloads:
        selected = [record for record in captured if workload['capturePrefix'] in record.get('url', '')
                    and record.get('method') == 'GET']
        assert len(selected) == workload['count'], f"Capture count mismatch for {workload['capturePrefix']}: {len(selected)}"
        assert len({record['id'] for record in selected}) == len(selected), 'Duplicate flow IDs'
        for record in selected:
            assert record['status'] == 200 and not record.get('error'), record
            assert len((record.get('responseBody') or '').encode()) <= limit
            assert record['responseBodySize'] == workload['expectedPayloadBytes'], record
            encoded = json.dumps(record)
            assert 'response-secret' not in encoded and 'second-secret' not in encoded
            if workload['expectedPayloadBytes'] > limit:
                assert record.get('responseBodyTruncated'), record
    return {'status': 'pass', 'completedRecords': len(captured),
            'workloadRecords': sum(workload['count'] for workload in workloads)}


def run(args):
    args.output.mkdir(parents=True, exist_ok=True)
    if not args.native.is_file():
        raise ValueError('Native executable absent; build it separately before benchmarking')
    fixtures = Fixtures(args.output / 'fixtures')
    cli = args.cli or [shutil.which('bun') or 'bun', str(Path(__file__).with_name('runner_cli.ts'))]
    report = {'status': 'running', 'buildType': args.build_type,
              'method': 'Fresh HTTP/1.1 Connection: close per curl call; no pooling. '
                        'Latency includes identical curl process launch and SHA256-independent network completion. '
                        'Added latency is the difference between proxy and direct distribution percentiles, not paired samples.',
              'comparisonLimitations': [
                  'Native captures are streamed as redacted JSONL without a retained request store; the existing Hakka CLI run includes Bun, mitmdump, mapped request records, and .hakka session export.',
                  'CPU and RSS therefore measure these complete pipelines, including their different retention and export work; they are not an intrinsic engine-only comparison or evidence of Noodle UI/plugin superiority.',
                  'A future engine comparison needs semantic parity through the same Hakka adapter/store/bridge and matched capture lifecycle.'
              ],
              'capture': {'maxBodyBytes': args.max_body_bytes, 'boundary': 'native redacted JSONL vs existing CLI mapped .hakka export',
                          'TLS': 'explicit task-local client CA + verified private origin CA; no global trust'},
              'environment': {'platform': platform.platform(), 'python': platform.python_version(),
                              'curl': version(['curl', '--version']), 'openssl': version(['openssl', 'version']),
                              'swift': version(['swift', '--version']), 'bun': version(['bun', '--version']),
                              'mitmdump': version([str(args.mitmdump), '--version']) if args.mitmdump else None,
                              'nativeSHA256': hashlib.sha256(args.native.read_bytes()).hexdigest(),
                              'revision': version(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']),
                              'dirtyFiles': version(['git', '-C', str(ROOT), 'status', '--porcelain'])},
              'controls': {'seed': args.seed, 'samplesPerScenario': args.samples, 'warmupsPerScenario': args.warmup,
                           'rounds': args.rounds, 'concurrency': [1, args.concurrency],
                           'ordering': 'seeded shuffled direct/native/mitm order per round; serialized engine processes',
                           'startup': 'fresh task-local CA dir each engine launch, generation included',
                           'memory': 'ready aggregate RSS baseline + sampled aggregate RSS peak per process tree'},
              'rounds': [], 'unavailable': []}
    engines = ['direct', 'native']
    if args.mitmdump and args.mitmdump.is_file():
        engines.append('mitm')
    else:
        report['unavailable'].append({'engine': 'mitm', 'reason': 'No existing mitmdump supplied; no dependency installation performed'})
    randomizer = random.Random(args.seed)
    try:
        for round_number in range(args.rounds):
            order = engines.copy()
            randomizer.shuffle(order)
            round_report = {'round': round_number, 'order': order, 'engines': {}}
            report['rounds'].append(round_report)
            for engine in order:
                proxy = None
                engine_report = {'workloads': [], 'status': 'running'}
                round_report['engines'][engine] = engine_report
                try:
                    if engine != 'direct':
                        proxy = ProxyProcess(engine, args.native if engine == 'native' else args.mitmdump,
                                             args.output / f'round-{round_number}-{engine}', fixtures.ca,
                                             args.max_body_bytes, cli=cli)
                        engine_report['startupReadinessMs'] = proxy.startup_ms
                    for tls in [False, True]:
                        for large in [False, True]:
                            for concurrency in sorted({1, args.concurrency}):
                                scenario = f'{"https" if tls else "http"}-{"large" if large else "small"}-c{concurrency}'
                                if args.warmup:
                                    warmup = run_workload(fixtures, proxy, args.warmup, concurrency, tls, large,
                                                          f'warm-{round_number}-{engine}-{scenario}')
                                    engine_report.setdefault('warmups', []).append(warmup)
                                workload = run_workload(fixtures, proxy, args.samples, concurrency, tls, large,
                                                        f'measured-{round_number}-{engine}-{scenario}')
                                workload.update({'scenario': scenario, 'concurrency': concurrency})
                                engine_report['workloads'].append(workload)
                    if proxy:
                        # Allow asynchronous capture consumers to drain before orderly export.
                        time.sleep(.2)
                        engine_report['processMetrics'] = proxy.close()
                        engine_report['captureVerification'] = verify_capture(proxy, engine_report['workloads'], args.max_body_bytes)
                        proxy = None
                    engine_report['status'] = 'pass'
                except Exception as error:
                    engine_report.update({'status': 'fail', 'error': str(error), 'traceback': traceback.format_exc()})
                    if proxy and proxy.process.poll() is None:
                        proxy.close(require_clean=False)
            direct = round_report['engines'].get('direct', {})
            for engine in ['native', 'mitm']:
                engine_report = round_report['engines'].get(engine, {})
                for workload in engine_report.get('workloads', []):
                    baseline = next((entry for entry in direct.get('workloads', []) if entry['scenario'] == workload['scenario']), None)
                    if baseline:
                        workload['addedDistributionLatencyMs'] = {key: workload[key] - baseline[key] for key in ['p50Ms', 'p95Ms', 'p99Ms']}
            (args.output / 'benchmark.json').write_text(json.dumps(report, indent=2) + '\n')
        report['status'] = 'pass' if all(engine['status'] == 'pass' for entry in report['rounds'] for engine in entry['engines'].values()) else 'fail'
        if report['unavailable'] and report['status'] == 'pass':
            report['status'] = 'partial'
    finally:
        fixtures.close()
        (args.output / 'benchmark.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--mitmdump', type=Path)
    parser.add_argument('--cli', nargs='+', help='Existing CLI executable command, e.g. bun packages/hakka-cli/dist/cli.mjs')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--build-type', choices=['debug', 'release'], required=True)
    parser.add_argument('--samples', type=int, default=30)
    parser.add_argument('--warmup', type=int, default=3)
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--concurrency', type=int, default=4)
    parser.add_argument('--seed', type=int, default=20261003)
    parser.add_argument('--max-body-bytes', type=int, default=1024)
    args = parser.parse_args()
    if min(args.samples, args.rounds, args.concurrency) < 1 or args.warmup < 0:
        parser.error('Counts/concurrency must be positive; warmup must be nonnegative')
    args.native, args.output = args.native.resolve(), args.output.resolve()
    if args.mitmdump:
        args.mitmdump = args.mitmdump.resolve()
    result = run(args)
    print(json.dumps({'status': result['status'], 'report': str(args.output / 'benchmark.json')}))
    raise SystemExit(1 if result['status'] == 'fail' else 0)
