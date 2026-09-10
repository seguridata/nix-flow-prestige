"""SDK Python de Prestige (M14). Cliente fino sobre la API real del BFF.

Uso:
    from prestige_client import PrestigeClient, verify_webhook_signature
    api = PrestigeClient("https://bff...", token="...")
    cases = api.get("/cases")
    req = api.post("/signature-requests", {"documentId": "...", "methods": ["DIGITAL"], "signers": [...]})

Sólo depende de `requests`. Los tipos/rutas exactas están en el OpenAPI
(`backend/contracts/openapi.generated.json`, servido en `/docs-json`); para
regenerar clientes tipados: `openapi-generator-cli generate -i openapi.generated.json -g python`.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

import requests


class PrestigeError(RuntimeError):
    def __init__(self, status: int, body: Any) -> None:
        super().__init__(f"Prestige API {status}: {body}")
        self.status = status
        self.body = body


class PrestigeClient:
    def __init__(self, base_url: str, token: str | None = None, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self._s = requests.Session()

    def _headers(self, has_body: bool) -> dict[str, str]:
        h: dict[str, str] = {}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if has_body:
            h["Content-Type"] = "application/json"
        return h

    def _call(self, method: str, path: str, body: Any = None, params: dict | None = None) -> Any:
        r = self._s.request(
            method,
            f"{self.base_url}{path}",
            headers=self._headers(body is not None),
            data=json.dumps(body) if body is not None else None,
            params=params,
            timeout=self.timeout,
        )
        parsed = r.json() if r.content else None
        if not r.ok:
            raise PrestigeError(r.status_code, parsed)
        return parsed

    def get(self, path: str, params: dict | None = None) -> Any:
        return self._call("GET", path, params=params)

    def post(self, path: str, body: Any = None) -> Any:
        return self._call("POST", path, body=body)

    def put(self, path: str, body: Any = None) -> Any:
        return self._call("PUT", path, body=body)

    def patch(self, path: str, body: Any = None) -> Any:
        return self._call("PATCH", path, body=body)

    def delete(self, path: str) -> Any:
        return self._call("DELETE", path)


def verify_webhook_signature(secret: str, timestamp: str, raw_body: str | bytes, signature_header: str) -> bool:
    """Valida `X-Prestige-Signature: sha256=<hmac(f'{timestamp}.{raw_body}')>`."""
    body = raw_body if isinstance(raw_body, bytes) else raw_body.encode()
    expected = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    got = signature_header.removeprefix("sha256=")
    return hmac.compare_digest(got, expected)
