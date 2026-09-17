"""Validated local images and restricted, bounded provider-result downloads."""
from __future__ import annotations

import asyncio
import io
import ipaddress
import os
from pathlib import Path
import socket
import uuid
import warnings

import httpx
from PIL import Image

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
DOWNLOAD_TIMEOUT = 30.0
# Exact result buckets only, never all of aliyuncs.com or arbitrary OSS buckets.
# https://help.aliyun.com/zh/model-studio/qwen-image-api
OFFICIAL_IMAGE_HOSTS = frozenset({
    'dashscope-result-wlcb.oss-cn-wulanchabu.aliyuncs.com',
    'dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com',
    'dashscope-result-sh.oss-cn-shanghai.aliyuncs.com',
})


def validate_image_bytes(data: bytes) -> str:
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError('IMAGE_SIZE_INVALID')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                extension = {'PNG': 'png', 'JPEG': 'jpg', 'WEBP': 'webp'}.get(image.format)
                if not extension or image.width * image.height > MAX_IMAGE_PIXELS or getattr(image, 'n_frames', 1) != 1:
                    raise ValueError('IMAGE_FORMAT_INVALID')
                image.verify()
            # verify checks structure; load also rejects truncated raster payloads.
            with Image.open(io.BytesIO(data)) as image:
                image.load()
        return extension
    except Exception as error:
        raise ValueError('IMAGE_FORMAT_INVALID') from error


def persist_image_bytes(directory: str | Path, data: bytes) -> str:
    extension = validate_image_bytes(data)
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    filename = f'{uuid.uuid4().hex}.{extension}'
    path = root / filename
    # Exclusive create prevents collisions/symlink substitution. The URL becomes
    # visible only after the complete file is written and closed.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return f'/api/images/{filename}'


async def download_image(url: str, provider_base_url: str) -> bytes:
    """Allow HTTPS provider/result origins, pin public DNS, refuse redirects."""
    try:
        target = httpx.URL(url)
        provider = httpx.URL(provider_base_url)
        allowed = set(OFFICIAL_IMAGE_HOSTS)
        if provider.host:
            allowed.add(provider.host.lower())
        if (target.scheme != 'https' or target.host.lower() not in allowed
                or target.port not in (None, 443) or target.userinfo or target.fragment):
            raise ValueError('IMAGE_DOWNLOAD_URL_DENIED')
        async with asyncio.timeout(DOWNLOAD_TIMEOUT):
            records = await asyncio.to_thread(socket.getaddrinfo, target.host, 443, type=socket.SOCK_STREAM)
            addresses = [ipaddress.ip_address(record[4][0]) for record in records]
            if not addresses or any(not address.is_global for address in addresses):
                raise ValueError('IMAGE_DOWNLOAD_ADDRESS_DENIED')
            # Connect to exactly the validated address; do not resolve again (DNS
            # rebinding). Keep original host for TLS/SNI and HTTP virtual hosting.
            pinned = target.copy_with(host=str(addresses[0]))
            async with httpx.AsyncClient(timeout=DOWNLOAD_TIMEOUT, follow_redirects=False, trust_env=False) as client:
                async with client.stream('GET', pinned, headers={'Host': target.host, 'Accept-Encoding': 'identity'},
                                         extensions={'sni_hostname': target.host}) as response:
                    if response.status_code != 200:
                        raise ValueError('IMAGE_DOWNLOAD_FAILED')
                    length = response.headers.get('content-length')
                    if length and int(length) > MAX_IMAGE_BYTES:
                        raise ValueError('IMAGE_SIZE_INVALID')
                    # Refuse compression so a tiny wire payload cannot inflate
                    # beyond the cap before a decoded chunk is yielded.
                    if response.headers.get('content-encoding', 'identity').lower() != 'identity':
                        raise ValueError('IMAGE_ENCODING_INVALID')
                    data = bytearray()
                    async for chunk in response.aiter_raw():
                        if len(data) + len(chunk) > MAX_IMAGE_BYTES:
                            raise ValueError('IMAGE_SIZE_INVALID')
                        data.extend(chunk)
            payload = bytes(data)
            validate_image_bytes(payload)
            return payload
    except (httpx.HTTPError, OSError, TimeoutError) as error:
        raise ValueError('IMAGE_DOWNLOAD_FAILED') from error
