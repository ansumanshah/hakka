#!/usr/bin/env python3
"""A bounded, streaming TCP relay used to shape Hakka proxy traffic.

The limits are per client TCP connection, not global. This gives independent
connections their configured upload and download rate. HTTP/2 streams sharing
one connection share that connection's rate. It shapes wire bytes, including
the CONNECT and TLS bytes between a client and mitmproxy. Bodies are copied in
small chunks and are never accumulated in memory.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class BandwidthLimits:
    """Byte-per-second limits. ``None`` leaves the direction unshaped."""

    upload_bytes_per_second: int | None = None
    download_bytes_per_second: int | None = None

    def __post_init__(self) -> None:
        for value in (self.upload_bytes_per_second, self.download_bytes_per_second):
            if value is not None and value < 1:
                raise ValueError("bandwidth limits must be positive byte-per-second values")


class BytePacer:
    """Monotonic leaky-bucket pacer with no initial burst.

    A separate instance is created for each direction of each proxied TCP
    connection. Awaiting here yields to asyncio, so a slow client never blocks
    unrelated proxy connections.
    """

    def __init__(self, bytes_per_second: int | None, clock=time.monotonic) -> None:
        self.bytes_per_second = bytes_per_second
        self.clock = clock
        self.next_send_at = clock()

    @property
    def chunk_size(self) -> int:
        if self.bytes_per_second is None:
            return 16 * 1024
        # About 50ms per chunk gives smooth pacing at low rates without making
        # high-rate transfers spend time scheduling tiny writes.
        # A one-byte chunk at 1 B/s is deliberate: a 1 KiB minimum would make
        # the first byte wait more than 17 minutes and violate the selected rate.
        return max(1, min(16 * 1024, self.bytes_per_second // 20))

    async def pace(self, byte_count: int) -> None:
        if self.bytes_per_second is None or byte_count == 0:
            return
        now = self.clock()
        self.next_send_at = max(self.next_send_at, now) + byte_count / self.bytes_per_second
        delay = self.next_send_at - now
        if delay > 0:
            await asyncio.sleep(delay)


async def copy_paced(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    pacer: BytePacer,
    idle_timeout_seconds: float,
) -> None:
    """Copy until EOF/cancellation, preserving a TCP half-close when possible."""
    try:
        while chunk := await asyncio.wait_for(reader.read(pacer.chunk_size), timeout=idle_timeout_seconds):
            await pacer.pace(len(chunk))
            writer.write(chunk)
            await writer.drain()
        if writer.can_write_eof():
            writer.write_eof()
            await writer.drain()
    except asyncio.TimeoutError as error:
        raise TimeoutError("relay connection was idle for too long") from error


class BandwidthRelay:
    def __init__(
        self,
        target_host: str,
        target_port: int,
        limits: BandwidthLimits,
        *,
        connect_timeout_seconds: float = 10,
        idle_timeout_seconds: float = 120,
        close_timeout_seconds: float = 2,
        max_clients: int = 64,
    ) -> None:
        self.target_host = target_host
        self.target_port = target_port
        self.limits = limits
        self.connect_timeout_seconds = connect_timeout_seconds
        self.idle_timeout_seconds = idle_timeout_seconds
        self.close_timeout_seconds = close_timeout_seconds
        self.max_clients = max_clients
        self.active_clients = 0

    async def handle(self, client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
        if self.active_clients >= self.max_clients:
            await self.close_writer(client_writer)
            return
        self.active_clients += 1
        try:
            server_reader, server_writer = await asyncio.wait_for(
                asyncio.open_connection(self.target_host, self.target_port), timeout=self.connect_timeout_seconds,
            )
            await self.pipe(client_reader, client_writer, server_reader, server_writer)
        except (OSError, TimeoutError, asyncio.TimeoutError):
            # A raw relay cannot safely synthesize an HTTP response: callers may
            # already be tunnelling TLS. Closing accurately reports the failure.
            pass
        finally:
            self.active_clients -= 1
            await self.close_writer(client_writer)

    async def close_writer(self, writer: asyncio.StreamWriter) -> None:
        writer.close()
        with contextlib.suppress(OSError, asyncio.TimeoutError):
            await asyncio.wait_for(writer.wait_closed(), timeout=self.close_timeout_seconds)

    async def pipe(
        self,
        client_reader: asyncio.StreamReader,
        client_writer: asyncio.StreamWriter,
        server_reader: asyncio.StreamReader,
        server_writer: asyncio.StreamWriter,
    ) -> None:
        upload = BytePacer(self.limits.upload_bytes_per_second)
        download = BytePacer(self.limits.download_bytes_per_second)
        tasks = (
            asyncio.create_task(copy_paced(client_reader, server_writer, upload, self.idle_timeout_seconds)),
            asyncio.create_task(copy_paced(server_reader, client_writer, download, self.idle_timeout_seconds)),
        )
        try:
            await asyncio.gather(*tasks)
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await self.close_writer(server_writer)

async def run(
    host: str, port: int, target_host: str, target_port: int, limits: BandwidthLimits,
    connect_timeout_seconds: float, idle_timeout_seconds: float, close_timeout_seconds: float, max_clients: int,
) -> None:
    relay = BandwidthRelay(
        target_host, target_port, limits, connect_timeout_seconds=connect_timeout_seconds,
        idle_timeout_seconds=idle_timeout_seconds, close_timeout_seconds=close_timeout_seconds, max_clients=max_clients,
    )
    server = await asyncio.start_server(relay.handle, host, port)
    bound_port = server.sockets[0].getsockname()[1]
    print(f'{{"type":"ready","port":{bound_port}}}', flush=True)
    async with server:
        await server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="Hakka streaming bandwidth relay")
    parser.add_argument("--listen-host", default="127.0.0.1")
    parser.add_argument("--listen-port", required=True, type=int)
    parser.add_argument("--target-host", default="127.0.0.1")
    parser.add_argument("--target-port", required=True, type=int)
    parser.add_argument("--upload-bps", type=int)
    parser.add_argument("--download-bps", type=int)
    parser.add_argument("--connect-timeout-seconds", type=float, default=10)
    parser.add_argument("--idle-timeout-seconds", type=float, default=120)
    parser.add_argument("--close-timeout-seconds", type=float, default=2)
    parser.add_argument("--max-clients", type=int, default=64)
    arguments = parser.parse_args()
    if not 0 <= arguments.listen_port <= 65535 or not 1 <= arguments.target_port <= 65535:
        parser.error("--listen-port must be from 0 through 65535 and --target-port from 1 through 65535")
    if any(value <= 0 for value in (arguments.connect_timeout_seconds, arguments.idle_timeout_seconds, arguments.close_timeout_seconds)):
        parser.error("timeouts must be positive seconds")
    if not 1 <= arguments.max_clients <= 1024:
        parser.error("--max-clients must be from 1 through 1024")
    try:
        limits = BandwidthLimits(arguments.upload_bps, arguments.download_bps)
    except ValueError as error:
        parser.error(str(error))
    try:
        asyncio.run(
            run(
                arguments.listen_host, arguments.listen_port, arguments.target_host, arguments.target_port, limits,
                arguments.connect_timeout_seconds, arguments.idle_timeout_seconds, arguments.close_timeout_seconds,
                arguments.max_clients,
            )
        )
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
