"""Emit completed mitmproxy HTTP flows to stdout as one Hakka JSON record per line."""
import json
import os
from mitmproxy import http

MAX_BODY = int(os.environ.get("HAKKA_PROXY_SIDECAR_BODY_BYTES", "102400"))

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
    def running(self) -> None:
        # mitmproxy calls this only after its proxy server is accepting connections.
        print('{"type":"ready"}', flush=True)

    def response(self, flow: http.HTTPFlow) -> None:
        self.emit(flow, None)

    def error(self, flow: http.HTTPFlow) -> None:
        self.emit(flow, flow.error.msg if flow.error else "Proxy flow failed")

    def emit(self, flow: http.HTTPFlow, error):
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
        # stdout is consumed only by Hakka's Node adapter. Never log certificates, keys, or config here.
        print(json.dumps(payload, separators=(",", ":")), flush=True)

addons = [HakkaCapture()]
