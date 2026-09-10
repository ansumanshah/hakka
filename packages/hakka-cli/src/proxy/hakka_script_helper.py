"""Authenticated loopback client for Hakka's bounded proxy script runtime."""

import asyncio
import copy
import json
import os
import re
import sys
import uuid
from urllib.parse import urlsplit

MAX_LINE_BYTES = 3 * 1024 * 1024
DEFAULT_BODY_BYTES = 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 0.25
METHOD = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
HEADER_NAME = METHOD


def _positive_integer(value, default):
    try:
        parsed = int(value)
        return parsed if parsed > 0 else default
    except (TypeError, ValueError):
        return default


def _timeout(value):
    try:
        parsed = float(value)
        return min(max(parsed, 0.05), 2.0)
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT_SECONDS


class HakkaScriptHelper:
    """Runs synchronous request/response hooks outside mitmproxy and fails open."""

    def __init__(self, port, token, max_body_bytes=DEFAULT_BODY_BYTES, timeout_seconds=DEFAULT_TIMEOUT_SECONDS, report=None):
        self.port = port
        self.token = token
        self.max_body_bytes = min(max_body_bytes, DEFAULT_BODY_BYTES)
        self.timeout_seconds = timeout_seconds
        self.report = report or (lambda message: print("hakka proxy: " + message, file=sys.stderr, flush=True))
        self.reader = None
        self.writer = None
        self.lock = asyncio.Lock()

    @classmethod
    def from_environment(cls, report=None):
        port_text = os.environ.get("HAKKA_PROXY_SCRIPT_PORT")
        token = os.environ.get("HAKKA_PROXY_SCRIPT_TOKEN")
        if not port_text or not token:
            return None
        port = _positive_integer(port_text, 0)
        if not 1 <= port <= 65535 or len(token) != 64:
            if report:
                report("Proxy scripting is disabled because its launch credentials are invalid.")
            return None
        return cls(
            port,
            token,
            _positive_integer(os.environ.get("HAKKA_PROXY_SCRIPT_BODY_BYTES"), DEFAULT_BODY_BYTES),
            _timeout(os.environ.get("HAKKA_PROXY_SCRIPT_TIMEOUT_SECONDS")),
            report,
        )

    async def close(self):
        writer, self.writer = self.writer, None
        self.reader = None
        if writer:
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), timeout=self.timeout_seconds)
            except (asyncio.TimeoutError, ConnectionError, OSError):
                pass

    def _body(self, message):
        try:
            content = message.get_content(strict=False)
        except AttributeError:
            content = getattr(message, "raw_content", None)
        if content is None or len(content) > self.max_body_bytes:
            return None
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return None

    @staticmethod
    def _headers(message):
        try:
            items = message.headers.items(multi=True)
        except TypeError:
            items = message.headers.items()
        return {str(name): str(value) for name, value in items}

    def _request(self, request):
        return {
            "url": request.pretty_url,
            "method": request.method,
            "headers": self._headers(request),
            "body": self._body(request),
        }

    def _response(self, response):
        return {
            "status": response.status_code,
            "headers": self._headers(response),
            "body": self._body(response),
        }

    @staticmethod
    def _remaining(deadline):
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise asyncio.TimeoutError
        return remaining

    async def _connect(self, deadline):
        self.reader, self.writer = await asyncio.wait_for(
            asyncio.open_connection("127.0.0.1", self.port, limit=MAX_LINE_BYTES + 1),
            timeout=self._remaining(deadline),
        )
        self.writer.write((json.dumps({"type": "auth", "token": self.token}, separators=(",", ":")) + "\n").encode())
        await asyncio.wait_for(self.writer.drain(), timeout=self._remaining(deadline))
        line = await asyncio.wait_for(self.reader.readline(), timeout=self._remaining(deadline))
        if len(line) > MAX_LINE_BYTES or json.loads(line) != {"type": "authenticated"}:
            raise ConnectionError("authentication failed")

    async def _execute(self, payload):
        deadline = asyncio.get_running_loop().time() + self.timeout_seconds
        acquired = False
        try:
            await asyncio.wait_for(self.lock.acquire(), timeout=self._remaining(deadline))
            acquired = True
            try:
                if not self.writer or self.writer.is_closing():
                    await self._connect(deadline)
                encoded = (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")
                if len(encoded) > MAX_LINE_BYTES:
                    self.report("The proxy script input exceeded its limit and the flow was left unchanged.")
                    return None
                self.writer.write(encoded)
                await asyncio.wait_for(self.writer.drain(), timeout=self._remaining(deadline))
                line = await asyncio.wait_for(self.reader.readline(), timeout=self._remaining(deadline))
                if not line or len(line) > MAX_LINE_BYTES:
                    raise ConnectionError("invalid response")
                result = json.loads(line)
                if result.get("type") != "result" or result.get("id") != payload["id"]:
                    raise ConnectionError("mismatched response")
                if result.get("outcome") == "error":
                    diagnostic = result.get("diagnostic")
                    self.report(diagnostic if isinstance(diagnostic, str) else "The proxy script failed and the flow was left unchanged.")
                    return None
                return result if result.get("outcome") == "applied" else None
            finally:
                self.lock.release()
                acquired = False
        except (asyncio.TimeoutError, ConnectionError, OSError, ValueError, json.JSONDecodeError):
            if acquired:
                self.lock.release()
            await self.close()
            self.report("The proxy script helper was unavailable and the flow was left unchanged.")
            return None

    async def start(self):
        """Authenticate before readiness so configuration failures are visible once."""
        deadline = asyncio.get_running_loop().time() + self.timeout_seconds
        try:
            await asyncio.wait_for(self.lock.acquire(), timeout=self._remaining(deadline))
            try:
                if not self.writer or self.writer.is_closing():
                    await self._connect(deadline)
                return True
            finally:
                self.lock.release()
        except (asyncio.TimeoutError, ConnectionError, OSError, ValueError, json.JSONDecodeError):
            await self.close()
            self.report("The proxy script helper was unavailable; capture will continue without script mutations.")
            return False

    @staticmethod
    def _valid_headers(headers):
        if not isinstance(headers, dict) or len(headers) > 256:
            return False
        return all(
            isinstance(name, str)
            and isinstance(value, str)
            and HEADER_NAME.fullmatch(name)
            and len(value.encode("utf-8")) <= 16 * 1024
            and not any(ord(character) <= 8 or 10 <= ord(character) <= 31 or ord(character) == 127 for character in value)
            for name, value in headers.items()
        )

    @staticmethod
    def _apply_headers(message, headers):
        try:
            current_items = list(message.headers.items(multi=True))
        except TypeError:
            current_items = list(message.headers.items())
        current = {str(name).lower(): (str(name), str(value)) for name, value in current_items}
        edited = {name.lower(): (name, value) for name, value in headers.items()}
        # Leave byte-for-byte-equivalent names alone so repeated headers such as
        # Set-Cookie retain their original multiplicity and order.
        for lowered, (name, value) in current.items():
            replacement = edited.get(lowered)
            if replacement is None:
                del message.headers[name]
            elif replacement[1] != value:
                message.headers[replacement[0]] = replacement[1]
        for lowered, (name, value) in edited.items():
            if lowered not in current:
                message.headers[name] = value

    def _valid_body(self, body):
        return body is None or (isinstance(body, str) and len(body.encode("utf-8")) <= self.max_body_bytes)

    def _apply_request(self, request, edits):
        if not isinstance(edits, dict) or not self._valid_headers(edits.get("headers")) or not self._valid_body(edits.get("body")):
            return None
        url = edits.get("url")
        method = edits.get("method")
        if not isinstance(url, str) or len(url.encode("utf-8")) > 16 * 1024 or urlsplit(url).scheme not in ("http", "https"):
            return None
        if not isinstance(method, str) or not METHOD.fullmatch(method):
            return None
        edited = copy.deepcopy(request)
        self._apply_headers(edited, edits["headers"])
        edited.url = url
        edited.method = method
        body = edits.get("body")
        if isinstance(body, str):
            edited.content = body.encode("utf-8")
        return edited

    def _apply_response(self, response, edits):
        if not isinstance(edits, dict) or not self._valid_headers(edits.get("headers")) or not self._valid_body(edits.get("body")):
            return None
        status = edits.get("status")
        if not isinstance(status, int) or isinstance(status, bool) or not 100 <= status <= 999:
            return None
        edited = copy.deepcopy(response)
        self._apply_headers(edited, edits["headers"])
        edited.status_code = status
        body = edits.get("body")
        if isinstance(body, str):
            edited.content = body.encode("utf-8")
        return edited

    async def request(self, flow):
        payload = {"type": "hook", "id": uuid.uuid4().hex, "phase": "request", "request": self._request(flow.request)}
        result = await self._execute(payload)
        if not result:
            return False
        try:
            edited = self._apply_request(flow.request, result.get("request"))
        except Exception:
            edited = None
        if edited is None:
            self.report("The proxy script returned invalid request edits and the flow was left unchanged.")
            return False
        flow.request = edited
        return True

    async def response(self, flow):
        payload = {
            "type": "hook",
            "id": uuid.uuid4().hex,
            "phase": "response",
            "request": self._request(flow.request),
            "response": self._response(flow.response),
        }
        result = await self._execute(payload)
        if not result:
            return False
        try:
            edited = self._apply_response(flow.response, result.get("response"))
        except Exception:
            edited = None
        if edited is None:
            self.report("The proxy script returned invalid response edits and the flow was left unchanged.")
            return False
        flow.response = edited
        return True
