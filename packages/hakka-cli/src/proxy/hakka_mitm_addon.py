"""Emit completed mitmproxy HTTP flows to stdout as one Hakka JSON record per line."""
import json
import os
import base64
import asyncio
import re
import sys
from pathlib import Path
from mitmproxy import ctx, http

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hakka_script_helper import HakkaScriptHelper

MAX_BODY = int(os.environ.get("HAKKA_PROXY_SIDECAR_BODY_BYTES", "102400"))
MAX_WS_MESSAGES = int(os.environ.get("HAKKA_PROXY_SIDECAR_WS_MESSAGES", "100"))
MAX_WS_BINARY = int(os.environ.get("HAKKA_PROXY_SIDECAR_WS_BINARY_BYTES", "32768"))
BREAKPOINT_HOST = "127.0.0.1"
BREAKPOINT_PORT = int(os.environ.get("HAKKA_PROXY_BREAKPOINT_PORT", "0"))
BREAKPOINT_TOKEN = os.environ.get("HAKKA_PROXY_BREAKPOINT_TOKEN", "")
BREAKPOINT_TIMEOUT = min(float(os.environ.get("HAKKA_PROXY_BREAKPOINT_TIMEOUT_SECONDS", "60")), 60.0)
BREAKPOINT_COMPLETION_TIMEOUT = 0.1
MAX_BREAKPOINT_LINE = 64 * 1024
MAX_PENDING_BREAKPOINTS = 64
UPSTREAM_AUTH = os.environ.get("HAKKA_PROXY_UPSTREAM_AUTH", "")
LATENCY_MS = min(max(int(os.environ.get("HAKKA_PROXY_LATENCY_MS", "0")), 0), 30000)
OFFLINE = os.environ.get("HAKKA_PROXY_OFFLINE") == "1"
SCRIPT_ENABLED = bool(os.environ.get("HAKKA_PROXY_SCRIPT_PORT") and os.environ.get("HAKKA_PROXY_SCRIPT_TOKEN"))

def report_script(message):
    print(json.dumps({"type": "diagnostic", "message": message}, separators=(",", ":")), flush=True)

def load_rules():
    path = os.environ.get("HAKKA_PROXY_RULE_CONFIG")
    if not path:
        return {"headerRules": [], "blockRules": [], "delayRules": []}
    with open(path, encoding="utf-8") as source:
        raw = json.load(source)
    # Node validates the source before mitmproxy starts. Compile once so traffic
    # paths only test expressions and never repeatedly parse rule configuration.
    return {
        "headerRules": [(re.compile(rule["match"]), rule) for rule in raw.get("headerRules", [])],
        "blockRules": [(re.compile(rule["match"]), rule) for rule in raw.get("blockRules", [])],
        "delayRules": [(re.compile(rule["match"]), rule) for rule in raw.get("delayRules", [])],
    }

RULES = load_rules()
HAS_REQUEST_RULES = bool(RULES["blockRules"]) or any(
    rule["phase"] == "request" for _, rule in RULES["headerRules"] + RULES["delayRules"]
)

def configure(updated):
    # mitmproxy cannot express an unset optional string with `--set`. Clear a
    # configured stream threshold in-process when static request rules need a
    # before-upstream guarantee for this managed sidecar session.
    if (
        "stream_large_bodies" in updated
        and (HAS_REQUEST_RULES or SCRIPT_ENABLED or LATENCY_MS or OFFLINE)
        and ctx.options.stream_large_bodies
    ):
        ctx.options.stream_large_bodies = None
    if UPSTREAM_AUTH and ctx.options.upstream_auth != UPSTREAM_AUTH:
        ctx.options.upstream_auth = UPSTREAM_AUTH

def matches(entries, url):
    return (rule for pattern, rule in entries if pattern.search(url))

def apply_headers(flow, phase):
    message = flow.request if phase == "request" else flow.response
    if not message:
        return
    for rule in matches(RULES["headerRules"], flow.request.pretty_url):
        if rule["phase"] != phase:
            continue
        name = rule["name"]
        if rule["operation"] == "remove":
            if name in message.headers:
                del message.headers[name]
        else:
            # Assignment replaces all variants of the case-insensitive header name.
            message.headers[name] = rule["value"]

async def apply_delay(flow, phase):
    rules = (rule for rule in matches(RULES["delayRules"], flow.request.pretty_url) if rule["phase"] == phase)
    await apply_rule_delays(rules)

async def apply_rule_delays(rules):
    milliseconds = sum(rule["delayMs"] for rule in rules)
    if milliseconds:
        await asyncio.sleep(min(milliseconds, 30000) / 1000)

def text_body(message):
    # get_content decodes Content-Encoding before capture; raw_content would expose gzip bytes.
    content = message.get_content(strict=False) or b""
    if len(content) > MAX_BODY:
        # Do not forward a partial JSON/body prefix to Node: it may be unparsable and cannot be
        # safely field-redacted there. The size and truncation marker remain available to Hakka.
        return None, len(content), True
    try:
        return content.decode("utf-8"), len(content), False
    except UnicodeDecodeError:
        return None, len(content), False

def headers(message):
    return [{"name": name, "value": value} for name, value in message.headers.items(multi=True)]

class HakkaCapture:
    def __init__(self):
        self.breakpoint_reader = None
        self.breakpoint_writer = None
        self.breakpoint_task = None
        self.breakpoint_completion_tasks = set()
        self.breakpoints = []
        self.pending_breakpoints = {}
        self.pause_counter = 0
        self.dynamic_stream_override = False
        self.dynamic_stream_value = None
        self.script_helper = HakkaScriptHelper.from_environment(report_script)

    async def running(self) -> None:
        if self.script_helper and not await self.script_helper.start():
            self.script_helper = None
        if BREAKPOINT_PORT and BREAKPOINT_TOKEN:
            try:
                self.breakpoint_reader, self.breakpoint_writer = await asyncio.open_connection(
                    BREAKPOINT_HOST, BREAKPOINT_PORT
                )
                await self.write_breakpoint({"type": "auth", "token": BREAKPOINT_TOKEN})
                self.breakpoint_task = asyncio.create_task(self.read_breakpoint_commands())
            except (OSError, asyncio.TimeoutError) as error:
                print(json.dumps({"type": "diagnostic", "message": f"live breakpoints unavailable: {error}"}), flush=True)
        # mitmproxy calls this only after its proxy server is accepting connections.
        print('{"type":"ready"}', flush=True)

    async def done(self) -> None:
        self.abort_all_breakpoints()
        self.set_breakpoints([])
        if self.breakpoint_task:
            self.breakpoint_task.cancel()
        for task in self.breakpoint_completion_tasks:
            task.cancel()
        if self.breakpoint_writer:
            self.breakpoint_writer.close()
            try:
                await self.breakpoint_writer.wait_closed()
            except OSError:
                pass
        if self.script_helper:
            await self.script_helper.close()

    async def write_breakpoint(self, message):
        if not self.breakpoint_writer:
            raise ConnectionError("proxy breakpoint bridge is disconnected")
        line = self.encode_breakpoint(message)
        self.breakpoint_writer.write(line)
        await self.breakpoint_writer.drain()

    def encode_breakpoint(self, message):
        line = json.dumps(message, separators=(",", ":")).encode("utf-8") + b"\n"
        if len(line) > MAX_BREAKPOINT_LINE:
            raise ValueError("proxy breakpoint message exceeds 64 KiB")
        return line

    def close_breakpoint_transport(self, writer):
        if self.breakpoint_writer is writer:
            self.breakpoint_writer = None
        writer.close()
        self.set_breakpoints([])
        self.abort_all_breakpoints()

    async def write_breakpoint_bounded(self, message, timeout):
        writer = self.breakpoint_writer
        if not writer:
            raise ConnectionError("proxy breakpoint bridge is disconnected")
        writer.write(self.encode_breakpoint(message))
        if timeout <= 0:
            self.close_breakpoint_transport(writer)
            raise asyncio.TimeoutError
        try:
            await asyncio.wait_for(writer.drain(), timeout=timeout)
        except (asyncio.TimeoutError, OSError):
            self.close_breakpoint_transport(writer)
            raise

    def send_breakpoint_completion(self, pause_id, result):
        async def send():
            try:
                await self.write_breakpoint_bounded(
                    {"type": "complete", "pauseId": pause_id, "result": result},
                    BREAKPOINT_COMPLETION_TIMEOUT,
                )
            except (asyncio.TimeoutError, ConnectionError, OSError, ValueError):
                pass

        task = asyncio.create_task(send())
        self.breakpoint_completion_tasks.add(task)
        task.add_done_callback(self.breakpoint_completion_tasks.discard)

    def abort_all_breakpoints(self):
        for future, _phase in self.pending_breakpoints.values():
            if not future.done():
                future.set_result({"action": "abort"})
        self.pending_breakpoints.clear()

    def set_breakpoints(self, breakpoints):
        request_active = any(
            rule.get("enabled") and rule.get("on", "request") in ("request", "both")
            for rule in breakpoints
        )
        if request_active and not HAS_REQUEST_RULES and not self.dynamic_stream_override:
            self.dynamic_stream_value = ctx.options.stream_large_bodies
            if self.dynamic_stream_value is not None:
                ctx.options.stream_large_bodies = None
                self.dynamic_stream_override = True
        elif not request_active and self.dynamic_stream_override:
            ctx.options.stream_large_bodies = self.dynamic_stream_value
            self.dynamic_stream_override = False
            self.dynamic_stream_value = None
        self.breakpoints = breakpoints

    def valid_action(self, message, phase):
        if message.get("action") == "abort":
            return True
        if message.get("action") != "resume":
            return False
        wrong = message.get("responseEdits") if phase == "request" else message.get("requestEdits")
        edits = message.get("requestEdits") if phase == "request" else message.get("responseEdits")
        if wrong is not None or (edits is not None and not isinstance(edits, dict)):
            return False
        if edits is None:
            return True
        if "body" in edits:
            return False
        headers_value = edits.get("headers")
        if headers_value is not None and (
            not isinstance(headers_value, dict)
            or not all(isinstance(name, str) and isinstance(value, str) for name, value in headers_value.items())
        ):
            return False
        if phase == "request":
            return (
                ("url" not in edits or isinstance(edits["url"], str) and edits["url"])
                and ("method" not in edits or isinstance(edits["method"], str) and edits["method"])
            )
        status = edits.get("status")
        return status is None or isinstance(status, int) and 100 <= status <= 999

    async def read_breakpoint_commands(self):
        try:
            while True:
                line = await self.breakpoint_reader.readline()
                if not line:
                    break
                if len(line) > MAX_BREAKPOINT_LINE:
                    break
                try:
                    message = json.loads(line)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue
                if message.get("type") == "rules" and isinstance(message.get("breakpoints"), list):
                    self.set_breakpoints(message["breakpoints"])
                elif message.get("type") == "abort-all":
                    self.abort_all_breakpoints()
                    self.set_breakpoints([])
                elif message.get("type") == "action":
                    pending = self.pending_breakpoints.get(message.get("pauseId"))
                    if pending and self.valid_action(message, pending[1]) and not pending[0].done():
                        pending[0].set_result(message)
        except (OSError, asyncio.IncompleteReadError):
            pass
        finally:
            self.set_breakpoints([])
            self.abort_all_breakpoints()
            self.breakpoint_reader = None
            self.breakpoint_writer = None

    def matching_breakpoint(self, flow, phase):
        for rule in self.breakpoints:
            if not rule.get("enabled") or rule.get("on", "request") not in (phase, "both"):
                continue
            if rule.get("pattern", "") not in flow.request.pretty_url:
                continue
            method = rule.get("method")
            if method and method.upper() != flow.request.method.upper():
                continue
            return rule
        return None

    async def pause_for_breakpoint(self, flow, phase):
        rule = self.matching_breakpoint(flow, phase)
        if not rule or not self.breakpoint_writer:
            return True
        if len(self.pending_breakpoints) >= MAX_PENDING_BREAKPOINTS:
            print(json.dumps({"type": "diagnostic", "message": "live breakpoint limit reached; request aborted"}), flush=True)
            return False
        self.pause_counter += 1
        loop = asyncio.get_running_loop()
        deadline = loop.time() + BREAKPOINT_TIMEOUT
        pause_id = f"proxy_{self.pause_counter}_{flow.id}_{phase}"
        future = loop.create_future()
        self.pending_breakpoints[pause_id] = (future, phase)
        message = {
            "type": "pause",
            "pauseId": pause_id,
            "ruleId": rule.get("id"),
            "phase": phase,
            "request": {
                "url": flow.request.pretty_url,
                "method": flow.request.method,
                "headers": dict(flow.request.headers.items()),
            },
        }
        if phase == "response":
            message["response"] = {
                "status": flow.response.status_code,
                "headers": dict(flow.response.headers.items()),
            }
        completion = "aborted"
        try:
            async def send_and_wait():
                await self.write_breakpoint(message)
                return await future
            action = await asyncio.wait_for(send_and_wait(), timeout=max(0, deadline - loop.time()))
            completion = "resumed" if action.get("action") == "resume" else "aborted"
        except asyncio.TimeoutError:
            action = {"action": "abort"}
            completion = "timeout"
        except (ConnectionError, OSError, ValueError):
            action = {"action": "abort"}
            completion = "disconnected"
        finally:
            self.pending_breakpoints.pop(pause_id, None)
            self.send_breakpoint_completion(pause_id, completion)
        if action.get("action") != "resume":
            return False
        edits = action.get("requestEdits") if phase == "request" else action.get("responseEdits")
        if edits:
            target = flow.request if phase == "request" else flow.response
            if phase == "request":
                if "url" in edits:
                    flow.request.url = edits["url"]
                if "method" in edits:
                    flow.request.method = edits["method"]
            elif "status" in edits:
                flow.response.status_code = edits["status"]
            if "headers" in edits:
                target.headers.clear()
                for name, value in edits["headers"].items():
                    target.headers[name] = value
        return True

    async def requestheaders(self, flow: http.HTTPFlow) -> None:
        # `request` runs only after an entire upload is buffered. Apply request
        # rules here so a streamed upload cannot reach upstream before a block,
        # header edit, or delay takes effect.
        url = flow.request.pretty_url
        blocks = list(matches(RULES["blockRules"], url))
        request_headers = [rule for rule in matches(RULES["headerRules"], url) if rule["phase"] == "request"]
        request_delays = [rule for rule in matches(RULES["delayRules"], url) if rule["phase"] == "request"]
        # A global stream threshold can otherwise forward upload bytes while an
        # asynchronous rule is still being applied. Matched request rules opt
        # out for that flow, preserving their before-upstream guarantee.
        if blocks or request_headers or request_delays or self.script_helper or LATENCY_MS or OFFLINE:
            flow.request.stream = False
        if OFFLINE:
            flow.response = http.Response.make(
                503,
                "Offline network profile",
                {"content-type": "text/plain; charset=utf-8"},
            )
            return
        for rule in blocks:
            flow.response = http.Response.make(
                rule.get("status", 403),
                rule.get("body", "Blocked by a local Hakka proxy rule."),
                {"content-type": "text/plain; charset=utf-8"},
            )
            return
        for rule in request_headers:
            name = rule["name"]
            if rule["operation"] == "remove":
                if name in flow.request.headers:
                    del flow.request.headers[name]
            else:
                flow.request.headers[name] = rule["value"]
        await apply_rule_delays(request_delays)
        if LATENCY_MS:
            await asyncio.sleep((LATENCY_MS // 2) / 1000)
        if not await self.pause_for_breakpoint(flow, "request"):
            flow.kill()

    async def request(self, flow: http.HTTPFlow) -> None:
        if self.script_helper and not flow.response:
            await self.script_helper.request(flow)

    async def response(self, flow: http.HTTPFlow) -> None:
        if self.script_helper:
            await self.script_helper.response(flow)
            if not await self.pause_for_breakpoint(flow, "response"):
                flow.kill()
                return
        # Response rules and optional script ran before mitmproxy forwards the body.
        self.emit(flow, None)

    async def responseheaders(self, flow: http.HTTPFlow) -> None:
        # This lifecycle point is early enough to modify headers before the client
        # receives them and still supports a bounded preview for streaming bodies.
        apply_headers(flow, "response")
        await apply_delay(flow, "response")
        if LATENCY_MS:
            await asyncio.sleep((LATENCY_MS - LATENCY_MS // 2) / 1000)
        if self.script_helper:
            flow.response.stream = False
            return
        if not await self.pause_for_breakpoint(flow, "response"):
            flow.kill()
            return
        self.emit(flow, None, partial=True)

    def error(self, flow: http.HTTPFlow) -> None:
        self.emit(flow, flow.error.msg if flow.error else "Proxy flow failed")

    def websocket_message(self, flow: http.HTTPFlow) -> None:
        # Update the same flow id so bridge consumers can show a live, bounded socket.
        self.emit(flow, None, partial=True)

    def websocket_end(self, flow: http.HTTPFlow) -> None:
        self.emit(flow, None)

    def emit(self, flow: http.HTTPFlow, error, partial=False):
        request_body, request_size, request_truncated = text_body(flow.request)
        response = flow.response
        response_body, response_size, response_truncated = text_body(response) if response else (None, 0, False)
        ended_at = (response.timestamp_end if response else flow.request.timestamp_end) or flow.request.timestamp_start
        payload = {
            "type": "flow",
            "id": flow.id,
            "startedAt": int(flow.request.timestamp_start * 1000),
            "endedAt": int(ended_at * 1000),
            "method": flow.request.method,
            "url": flow.request.pretty_url,
            "requestHeaders": headers(flow.request),
            "requestBody": request_body,
            "requestBodySize": request_size,
            "requestBodyTruncated": request_truncated,
            "status": response.status_code if response else None,
            "responseHeaders": headers(response) if response else [],
            "responseBody": response_body,
            "responseBodySize": response_size,
            "responseBodyTruncated": response_truncated,
            "error": error,
            "contentType": response.headers.get("content-type") if response else None,
            "httpVersion": flow.request.http_version,
        }
        if flow.websocket:
            messages = []
            for message in flow.websocket.messages[-MAX_WS_MESSAGES:]:
                content = message.content
                if message.is_text:
                    if len(content) > MAX_BODY:
                        # Do not ship a text prefix: it can contain a secret or incomplete JSON.
                        data = len(content)
                        truncated = True
                    else:
                        try:
                            data = content.decode("utf-8")
                        except UnicodeDecodeError:
                            data = None
                        truncated = False
                    binary = False
                else:
                    data = base64.b64encode(content).decode("ascii") if len(content) <= MAX_WS_BINARY else len(content)
                    binary = True
                    truncated = len(content) > MAX_WS_BINARY
                messages.append({"timestamp": int(message.timestamp * 1000), "direction": "sent" if message.from_client else "received", "data": data if data is not None else len(content), "size": len(content), "binary": binary, "truncated": truncated})
            payload["messages"] = messages
            payload["wsProtocol"] = getattr(flow.websocket, "protocol", "") or ""
            payload["partial"] = partial
        # stdout is consumed only by Hakka's Node adapter. Never log certificates, keys, or config here.
        print(json.dumps(payload, separators=(",", ":")), flush=True)

addons = [HakkaCapture()]
