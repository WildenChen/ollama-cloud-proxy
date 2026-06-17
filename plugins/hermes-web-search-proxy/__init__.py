from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

PLUGIN_NAME = "hermes-web-search-proxy"
CONFIG_PATH = Path.home() / ".hermes" / "plugins" / PLUGIN_NAME / "config.json"

DEFAULT_CONFIG: Dict[str, Any] = {
    "base_url": "http://127.0.0.1:11435",
    "search_path": "/v1/web/search",
    "fetch_path": "/v1/web/fetch",
    "timeout_seconds": 30,
    "max_results": 5,
}

TOOLS = [
    {
        "name": "proxy_web_search",
        "description": "Search the web through ollama-cloud-proxy.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "max_results": {"type": "integer"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "proxy_web_fetch",
        "description": "Fetch a web page through ollama-cloud-proxy.",
        "input_schema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
        },
    },
]


def get_tools() -> list[dict[str, Any]]:
    return TOOLS


def call_tool(name: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    arguments = arguments or {}
    if name == "proxy_web_search":
        return proxy_web_search(
            query=str(arguments.get("query", "")),
            max_results=arguments.get("max_results"),
        )
    if name == "proxy_web_fetch":
        return proxy_web_fetch(url=str(arguments.get("url", "")))
    return {"error": f"Unknown tool: {name}"}


def proxy_web_search(query: str, max_results: Optional[int] = None) -> Dict[str, Any]:
    query = query.strip()
    if not query:
        return {"error": "query is required"}

    config = _load_config()
    if "error" in config:
        return config

    configured_max = _int_or_default(config.get("max_results"), 5)
    requested_max = _int_or_default(max_results, configured_max)
    return _post_json(
        config,
        str(config.get("search_path") or "/v1/web/search"),
        {"query": query, "max_results": requested_max},
    )


def proxy_web_fetch(url: str) -> Dict[str, Any]:
    url = url.strip()
    if not url:
        return {"error": "url is required"}

    config = _load_config()
    if "error" in config:
        return config

    return _post_json(
        config,
        str(config.get("fetch_path") or "/v1/web/fetch"),
        {"url": url},
    )


def _load_config() -> Dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {
            "error": f"Missing config: {CONFIG_PATH}",
            "hint": "Copy config.example.json to config.json and set base_url plus client_token.",
        }

    try:
        loaded = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - plugin returns user-readable errors.
        return {"error": f"Invalid config.json: {exc}"}

    if not isinstance(loaded, dict):
        return {"error": "config.json must be a JSON object"}

    config = {**DEFAULT_CONFIG, **loaded}
    token = str(config.get("client_token") or "").strip()
    if not token or token == "change-me":
        return {"error": "client_token is required in config.json"}
    config["client_token"] = token
    return config


def _post_json(config: Dict[str, Any], path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    base_url = str(config.get("base_url") or DEFAULT_CONFIG["base_url"]).rstrip("/")
    url = f"{base_url}{path if path.startswith('/') else '/' + path}"
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {config['client_token']}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=float(config.get("timeout_seconds") or 30)) as response:
            return _decode_response(response.read())
    except urllib.error.HTTPError as exc:
        return {
            "error": f"Proxy returned HTTP {exc.code}",
            "details": _safe_error_body(exc),
        }
    except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
        return {"error": f"Proxy request failed: {_safe_message(exc)}"}
    except Exception as exc:  # noqa: BLE001 - plugin boundary should not crash Hermes.
        return {"error": f"Unexpected plugin error: {_safe_message(exc)}"}


def _decode_response(data: bytes) -> Dict[str, Any]:
    try:
        decoded = json.loads(data.decode("utf-8"))
        if isinstance(decoded, dict):
            return decoded
        return {"result": decoded}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"Proxy returned invalid JSON: {exc}"}


def _safe_error_body(exc: urllib.error.HTTPError) -> str:
    try:
        return exc.read(1200).decode("utf-8", errors="replace")
    except Exception:
        return ""


def _safe_message(exc: BaseException) -> str:
    return str(exc).replace(str(DEFAULT_CONFIG.get("client_token", "")), "[redacted]")[:500]


def _int_or_default(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default
