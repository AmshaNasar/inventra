"""OpenRouter client (OpenAI-compatible chat completions). Optional: no key means keyless mode.

Data minimisation: only the engine's fact set, or the typed question plus the lists of
valid IDs, is ever sent. The API key is read from .env and never logged or returned.
"""
from __future__ import annotations

import logging
from typing import List, Optional

import httpx

from ..config import settings

log = logging.getLogger("inventra.llm")


class LLMUnavailable(Exception):
    pass


def chat(messages: List[dict], max_tokens: int = 400, json_mode: bool = False) -> str:
    if not settings.keyed:
        raise LLMUnavailable("keyless mode")
    body = {"model": settings.llm_model, "messages": messages, "temperature": 0, "max_tokens": max_tokens}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    try:
        r = httpx.post(f"{settings.llm_base_url}/chat/completions", json=body,
                       headers={"Authorization": f"Bearer {settings.llm_api_key}", "X-Title": "Inventra"},
                       timeout=settings.llm_timeout_seconds)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"] or ""
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
        # never include the request (and so the key) in logs
        log.warning("LLM call failed: %s", type(e).__name__)
        raise LLMUnavailable(type(e).__name__)
