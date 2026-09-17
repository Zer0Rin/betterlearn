import io
import re
import socket
from unittest.mock import AsyncMock
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image

from app.services import local_image_service as local

HTTP_CLIENT = httpx.AsyncClient


def image_bytes(format='PNG'):
    stream = io.BytesIO()
    Image.new('RGB', (4, 4), 'red').save(stream, format=format)
    return stream.getvalue()


@pytest.mark.parametrize(('format', 'extension'), [('PNG', 'png'), ('JPEG', 'jpg'), ('WEBP', 'webp')])
def test_persist_valid_image_with_server_owned_name(tmp_path, format, extension):
    data = image_bytes(format)
    url = local.persist_image_bytes(tmp_path, data)
    assert re.fullmatch(r'/api/images/[a-f0-9]{32}\.' + extension, url)
    assert (tmp_path / url.rsplit('/', 1)[1]).read_bytes() == data
    assert (tmp_path / url.rsplit('/', 1)[1]).stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize('data', [b'<svg/>', b'\x89PNG\r\n\x1a\ninvalid', b'x' * (10 * 1024 * 1024 + 1)])
def test_invalid_or_oversized_image_creates_no_file(tmp_path, data):
    with pytest.raises(ValueError):
        local.persist_image_bytes(tmp_path, data)
    assert not list(tmp_path.iterdir())


def test_unsupported_or_truncated_decoding_rejected(tmp_path):
    for data in [image_bytes('GIF'), image_bytes('JPEG')[:-20]]:
        with pytest.raises(ValueError):
            local.persist_image_bytes(tmp_path, data)
    assert not list(tmp_path.iterdir())


def mock_network(monkeypatch, handler, addresses=('93.184.216.34',)):
    monkeypatch.setattr(local.socket, 'getaddrinfo', lambda *args, **kwargs: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, 443)) for ip in addresses
    ])
    original = HTTP_CLIENT
    monkeypatch.setattr(local.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))


@pytest.mark.asyncio
async def test_download_pins_public_ip_and_keeps_tls_hostname(monkeypatch):
    calls = []
    def reply(request):
        calls.append(request)
        return httpx.Response(200, stream=httpx.ByteStream(image_bytes()))
    mock_network(monkeypatch, reply)
    data = await local.download_image('https://images.provider.example/a.png?token=abc', 'https://images.provider.example/v1')
    assert data == image_bytes()
    assert len(calls) == 1
    assert calls[0].url.host == '93.184.216.34'
    assert calls[0].headers['host'] == 'images.provider.example'
    assert calls[0].extensions['sni_hostname'] == 'images.provider.example'


@pytest.mark.asyncio
@pytest.mark.parametrize('url', [
    'file:///etc/passwd', 'http://images.provider.example/x', 'https://evil.example/x',
    'https://dashscope-result-wlcb.oss-cn-wulanchabu.aliyuncs.com.evil.example/x',
    'https://images.provider.example:444/x', 'https://user:secret@images.provider.example/x',
    'https://127.0.0.1/x', 'https://[::1]/x',
])
async def test_disallowed_download_urls_never_connect(monkeypatch, url):
    mock_network(monkeypatch, lambda request: pytest.fail('unexpected network request'))
    with pytest.raises(ValueError):
        await local.download_image(url, 'https://images.provider.example/v1')


@pytest.mark.asyncio
@pytest.mark.parametrize('ip', ['127.0.0.1', '10.0.0.2', '169.254.169.254', '::1', 'fe80::1', '100.64.0.1'])
async def test_private_dns_blocks_even_configured_provider(monkeypatch, ip):
    mock_network(monkeypatch, lambda request: pytest.fail('unexpected network request'), (ip,))
    with pytest.raises(ValueError):
        await local.download_image('https://images.provider.example/x', 'https://images.provider.example/v1')


@pytest.mark.asyncio
async def test_redirects_not_followed_and_download_bytes_capped(monkeypatch):
    mock_network(monkeypatch, lambda request: httpx.Response(302, headers={'location': 'http://127.0.0.1/secret'}))
    with pytest.raises(ValueError):
        await local.download_image('https://images.provider.example/x', 'https://images.provider.example/v1')
    mock_network(monkeypatch, lambda request: httpx.Response(200, stream=httpx.ByteStream(b'x' * (local.MAX_IMAGE_BYTES + 1))))
    with pytest.raises(ValueError):
        await local.download_image('https://images.provider.example/x', 'https://images.provider.example/v1')


@pytest.mark.asyncio
async def test_official_result_host_allowed(monkeypatch):
    mock_network(monkeypatch, lambda request: httpx.Response(200, stream=httpx.ByteStream(image_bytes())))
    assert await local.download_image('https://dashscope-result-wlcb.oss-cn-wulanchabu.aliyuncs.com/x', '') == image_bytes()


@pytest.mark.asyncio
async def test_local_mode_works_without_cos(tmp_path, monkeypatch):
    from app.services import image_service
    from app.core.config import get_settings
    settings = get_settings().model_copy(update={'local_image_dir': str(tmp_path)})
    monkeypatch.setattr(image_service, 'get_settings', lambda: settings)
    monkeypatch.setattr(image_service, '_call_image_model_sync', lambda prompt: 'https://fake.example/image')
    monkeypatch.setattr(image_service, '_download_image', AsyncMock(return_value=image_bytes()))
    monkeypatch.setattr(image_service, 'upload_image_bytes', AsyncMock(side_effect=AssertionError('COS must not be required')))
    url = await image_service.generate_image_for_question(SimpleNamespace(id='q1', stem='学习植物', knowledge_point='植物'), 'quiz1')
    assert url and url.startswith('/api/images/')
    assert (tmp_path / url.rsplit('/', 1)[1]).is_file()


def test_image_pixel_budget_rejects_before_decode(tmp_path, monkeypatch):
    monkeypatch.setattr(local, 'MAX_IMAGE_PIXELS', 4)
    with pytest.raises(ValueError):
        local.persist_image_bytes(tmp_path, image_bytes())
    assert not list(tmp_path.iterdir())


@pytest.mark.asyncio
async def test_mixed_private_and_public_dns_is_denied(monkeypatch):
    mock_network(monkeypatch, lambda request: pytest.fail('unexpected request'), ('93.184.216.34', '127.0.0.1'))
    with pytest.raises(ValueError):
        await local.download_image('https://images.provider.example/x', 'https://images.provider.example')


@pytest.mark.asyncio
async def test_download_total_timeout_and_compressed_payload_denied(monkeypatch):
    import asyncio
    async def stalled(request):
        await asyncio.sleep(10)
    mock_network(monkeypatch, stalled)
    monkeypatch.setattr(local, 'DOWNLOAD_TIMEOUT', .01)
    with pytest.raises(ValueError, match='IMAGE_DOWNLOAD_FAILED'):
        await local.download_image('https://images.provider.example/x', 'https://images.provider.example')
    mock_network(monkeypatch, lambda request: httpx.Response(200, headers={'content-encoding': 'gzip'}, stream=httpx.ByteStream(b'compressed')))
    with pytest.raises(ValueError, match='IMAGE_ENCODING_INVALID'):
        await local.download_image('https://images.provider.example/x', 'https://images.provider.example')
