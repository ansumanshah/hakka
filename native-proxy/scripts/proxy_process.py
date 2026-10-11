"""Subprocess ownership, bounded JSONL observations, and process-tree measurements."""
import json
import os
import shutil
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path


def available_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def cpu_seconds(value):
    parts = value.replace('-', ':').split(':')
    total = 0.0
    for part in parts:
        total = total * 60 + float(part)
    return total


class ProcessMetrics:
    def __init__(self, pid):
        self.pid = pid
        self.peak_rss_kib = None
        self.cpu_by_pid = {}
        self.baseline_rss_kib = None
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()
    def sample(self):
        output = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,rss=,time='],
                                text=True, capture_output=True, check=True).stdout
        rows = {}
        for line in output.splitlines():
            fields = line.split()
            if len(fields) == 4:
                rows[int(fields[0])] = (int(fields[1]), int(fields[2]), cpu_seconds(fields[3]))
        owned = {self.pid}
        while True:
            expanded = owned | {pid for pid, row in rows.items() if row[0] in owned}
            if expanded == owned:
                break
            owned = expanded
        rss = sum(rows[pid][1] for pid in owned if pid in rows)
        for pid in owned:
            if pid in rows:
                self.cpu_by_pid[pid] = max(self.cpu_by_pid.get(pid, 0), rows[pid][2])
        if rss:
            self.peak_rss_kib = max(self.peak_rss_kib or 0, rss)
        return rss or None
    def run(self):
        while not self.stop.is_set():
            try:
                self.sample()
            except (ValueError, OSError, subprocess.SubprocessError):
                pass
            self.stop.wait(.05)
    def finish(self):
        self.stop.set()
        self.thread.join()
        return {'cpuSecondsProcessTreeSampled': sum(self.cpu_by_pid.values()) if self.cpu_by_pid else None,
                'peakRssKiBProcessTreeSampled': self.peak_rss_kib,
                'readyBaselineRssKiBProcessTree': self.baseline_rss_kib,
                'samplingIntervalMs': 50,
                'limitations': 'RSS is sampled aggregate resident memory, not unique physical memory; '
                               'CPU uses ps precision and can miss short-lived descendants.'}


class ProxyProcess:
    def __init__(self, engine, executable, directory, upstream_ca, body_limit, cli=None):
        self.engine, self.directory = engine, directory
        directory.mkdir(parents=True, exist_ok=True)
        self.events, self.condition, self.stop_event = [], threading.Condition(), threading.Event()
        self.session_path = directory / 'capture.hakka'
        ca_dir = directory / 'proxy-ca'
        ca_dir.mkdir(mode=0o700)
        # Respect the native CA store's private-directory ownership contract
        # even when the process umask or an existing parent would alter mode.
        os.chmod(ca_dir, 0o700)
        if engine == 'native':
            command = [str(executable), '--host', '127.0.0.1', '--port', '0',
                       '--max-body-bytes', str(body_limit)]
            if upstream_ca:
                command += ['--ca-dir', str(ca_dir), '--upstream-ca', str(upstream_ca)]
        else:
            self.port = available_port()
            (ca_dir / 'config.yaml').write_text('ssl_verify_upstream_trusted_ca: ' + str(upstream_ca) + '\n')
            command = list(cli) + ['proxy', '--json', '--host', '127.0.0.1', '--port', str(self.port),
                       '--max-capture-body', str(body_limit), '--mitmdump', str(executable),
                       '--config-dir', str(ca_dir), '--session', str(self.session_path)]
            # The source adapter already enters the proxy command directly.
            if len(cli) >= 2 and str(cli[-1]).endswith('runner_cli.ts'):
                command.remove('proxy')
        self.command = command
        self.stderr_file = open(directory / 'stderr.log', 'w')
        self.stdout_file = open(directory / 'stdout.jsonl', 'w')
        started = time.perf_counter()
        self.process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                        stderr=self.stderr_file, text=True, start_new_session=True)
        self.metrics = ProcessMetrics(self.process.pid)
        self.reader = threading.Thread(target=self.read, daemon=True)
        self.reader.start()
        try:
            ready = self.wait(lambda event: event.get('type') == 'ready' if engine == 'native'
                              else event.get('command') == 'proxy' and event.get('status') == 'started', 30)
        except Exception:
            self.close(require_clean=False)
            raise
        self.startup_ms = (time.perf_counter() - started) * 1000
        self.port = ready.get('port', getattr(self, 'port', None))
        assert self.port and ready.get('host', '127.0.0.1') == '127.0.0.1', ready
        self.ca = ready.get('caCertificatePath') if engine == 'native' else ready.get('certificates', {}).get('publicCaPath')
        if upstream_ca and not self.ca:
            raise AssertionError('Ready event did not provide the explicit client CA path')
        self.metrics.baseline_rss_kib = self.metrics.sample()
    def read(self):
        for line in self.process.stdout:
            self.stdout_file.write(line)
            self.stdout_file.flush()
            if len(line) > 2 * 1024 * 1024:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            with self.condition:
                self.events.append(event)
                self.condition.notify_all()
        self.stop_event.set()
        with self.condition:
            self.condition.notify_all()
    def wait(self, predicate, timeout=10):
        deadline = time.monotonic() + timeout
        with self.condition:
            while True:
                for event in self.events:
                    if predicate(event):
                        return event
                if self.stop_event.is_set() or time.monotonic() >= deadline:
                    raise AssertionError(f'{self.engine}: missing event; see {self.directory}')
                self.condition.wait(min(.2, deadline - time.monotonic()))
    def flows(self):
        return [event for event in self.events if event.get('type') == 'flow']
    def close(self, require_clean=True):
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
        try:
            code = self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(self.process.pid, signal.SIGKILL)
            self.process.wait()
            raise AssertionError('Proxy did not stop within 10 seconds')
        self.reader.join(timeout=2)
        metrics = self.metrics.finish()
        self.stdout_file.close()
        self.stderr_file.close()
        if require_clean:
            assert code == 0, f'{self.engine} exited {code}'
            assert any(event.get('type') == 'stopped' or event.get('status') == 'stopped'
                       for event in self.events), 'Missing stopped event'
            with socket.socket() as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(('127.0.0.1', self.port))
        return metrics
