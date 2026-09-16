"""
اتصال به ارائه‌دهنده‌های مدل زبانی.

سه شکل API در دنیا هست و بقیه تقلیدِ یکی از آن‌هایند:
    • OpenAI (‎/chat/completions) — که OpenRouter، Groq، DeepSeek، Together،
      و حتی Ollama محلی هم همان را می‌پذیرند
    • Gemini (‎:generateContent)
    • Anthropic (‎/v1/messages)

پس به‌جای یک کلاس برای هر شرکت، سه «گویش» داریم و فهرست ارائه‌دهنده‌ها فقط
می‌گوید هرکدام کدام گویش را حرف می‌زند و نشانی‌اش کجاست. افزودن ارائه‌دهندهٔ
تازه یک سطر است، نه یک ماژول.

عمداً از urllib کتابخانهٔ استاندارد استفاده می‌شود نه از یک وابستگی تازه:
یک درخواست POST با JSON و مهلت، همین. هر وابستگی‌ای که اضافه شود باید در
بستهٔ ویندوزی هم بنشیند و نگه‌داری شود.
"""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

TIMEOUT = 180          # مدل‌های کند روی پرسش‌های بلند، یک دقیقه هم کم دارند


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    dialect: str                     # openai | gemini | anthropic
    base_url: str
    default_model: str
    models: tuple[str, ...] = ()
    key_url: str = ""
    note: str = ""
    editable_base_url: bool = False


PROVIDERS: tuple[Provider, ...] = (
    Provider(
        id="openai", name="OpenAI", dialect="openai",
        base_url="https://api.openai.com/v1",
        default_model="gpt-4o-mini",
        models=("gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "o4-mini"),
        key_url="https://platform.openai.com/api-keys",
    ),
    Provider(
        id="gemini", name="Google Gemini", dialect="gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta",
        default_model="gemini-2.0-flash",
        models=("gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"),
        key_url="https://aistudio.google.com/apikey",
    ),
    Provider(
        id="openrouter", name="OpenRouter", dialect="openai",
        base_url="https://openrouter.ai/api/v1",
        default_model="google/gemini-2.0-flash-001",
        models=(
            "google/gemini-2.0-flash-001",
            "openai/gpt-4o-mini",
            "anthropic/claude-3.5-haiku",
            "meta-llama/llama-3.3-70b-instruct",
            "qwen/qwen-2.5-72b-instruct",
        ),
        key_url="https://openrouter.ai/keys",
        note="از یک کلید به ده‌ها مدل دسترسی می‌دهد.",
    ),
    Provider(
        id="anthropic", name="Anthropic Claude", dialect="anthropic",
        base_url="https://api.anthropic.com/v1",
        default_model="claude-sonnet-5",
        models=("claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"),
        key_url="https://console.anthropic.com/settings/keys",
    ),
    Provider(
        id="custom", name="سازگار با OpenAI", dialect="openai",
        base_url="http://127.0.0.1:11434/v1",
        default_model="qwen2.5-coder:7b",
        key_url="",
        note="برای Ollama، LM Studio، vLLM یا هر سرویس سازگار با OpenAI.",
        editable_base_url=True,
    ),
)

BY_ID = {p.id: p for p in PROVIDERS}


def catalog() -> list[dict]:
    """فهرست ارائه‌دهنده‌ها برای رابط کاربری — بدون هیچ کلیدی."""
    return [
        {
            "id": p.id, "name": p.name, "dialect": p.dialect,
            "base_url": p.base_url, "default_model": p.default_model,
            "models": list(p.models), "key_url": p.key_url, "note": p.note,
            "editable_base_url": p.editable_base_url,
        }
        for p in PROVIDERS
    ]


class ProviderError(RuntimeError):
    """خطای قابل‌نمایش به کاربر — پیامش فارسی و بدون جزئیات بی‌فایده است."""


LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def _opener(url: str):
    """
    برای سرویس محلی، پروکسی دور زده می‌شود.

    چرا: روی رایانهٔ سازمانی معمولاً http_proxy تنظیم است تا ترافیک بیرونی
    از پروکسی رد شود — و همین درست است، چون OpenAI و Gemini بیرون‌اند. ولی
    urllib همان قاعده را روی 127.0.0.1 هم اعمال می‌کند، و آن وقت مدلی که
    روی خودِ همین دستگاه بالاست (Ollama، LM Studio) از راه پروکسی خواسته
    می‌شود و هرگز جواب نمی‌دهد.
    """
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if host in LOCAL_HOSTS or host.endswith(".local"):
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener()


def _post(url: str, payload: dict, headers: dict, timeout: int) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "content-type": "application/json", **headers,
    })
    try:
        with _opener(url).open(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:400]
        except Exception:                                    # noqa: BLE001
            pass
        if e.code in (401, 403):
            raise ProviderError("کلید API پذیرفته نشد. کلید را در تنظیمات بررسی کنید.") from e
        if e.code == 404:
            raise ProviderError("نام مدل یا نشانی سرویس پیدا نشد؛ در تنظیمات بررسی کنید.") from e
        if e.code == 429:
            raise ProviderError("سرویس فعلاً محدودیت نرخ گذاشته؛ کمی بعد دوباره تلاش کنید.") from e
        if 500 <= e.code < 600:
            raise ProviderError(f"سرویسِ مدل خطای داخلی داد ({e.code}).") from e
        raise ProviderError(f"سرویسِ مدل خطای {e.code} داد. {detail}") from e
    except urllib.error.URLError as e:
        raise ProviderError(
            "به سرویس مدل وصل نشدیم. اتصال اینترنت و نشانی سرویس را بررسی کنید."
        ) from e
    except socket.timeout as e:
        raise ProviderError("پاسخ مدل در زمان مقرر نرسید.") from e
    except json.JSONDecodeError as e:
        raise ProviderError("پاسخ سرویس قابل خواندن نبود.") from e


def complete(
    *,
    provider_id: str,
    api_key: str,
    model: str,
    system: str,
    user: str,
    base_url: str = "",
    temperature: float = 0.0,
    max_tokens: int = 2000,
    timeout: int = TIMEOUT,
) -> str:
    """یک پرسش، یک پاسخ متنی. هر گویش، شکل خودش."""
    provider = BY_ID.get(provider_id)
    if provider is None:
        raise ProviderError(f"ارائه‌دهندهٔ «{provider_id}» شناخته نشد.")
    if not api_key and provider.id != "custom":
        raise ProviderError("کلید API ثبت نشده است. از تنظیمات اضافه‌اش کنید.")

    root = (base_url or provider.base_url).rstrip("/")

    if provider.dialect == "openai":
        data = _post(
            f"{root}/chat/completions",
            {
                "model": model, "temperature": temperature,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
            {"authorization": f"Bearer {api_key}"} if api_key else {},
            timeout,
        )
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as e:
            raise ProviderError("پاسخ سرویس شکل منتظره را نداشت.") from e

    if provider.dialect == "gemini":
        data = _post(
            f"{root}/models/{model}:generateContent",
            {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "generationConfig": {
                    "temperature": temperature,
                    "maxOutputTokens": max_tokens,
                },
            },
            {"x-goog-api-key": api_key},
            timeout,
        )
        try:
            parts = data["candidates"][0]["content"]["parts"]
            return "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError, TypeError) as e:
            blocked = (data.get("promptFeedback") or {}).get("blockReason")
            if blocked:
                raise ProviderError(f"سرویس پاسخ را رد کرد ({blocked}).") from e
            raise ProviderError("پاسخ سرویس شکل منتظره را نداشت.") from e

    if provider.dialect == "anthropic":
        data = _post(
            f"{root}/messages",
            {
                "model": model, "max_tokens": max_tokens,
                "temperature": temperature, "system": system,
                "messages": [{"role": "user", "content": user}],
            },
            {"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            timeout,
        )
        try:
            return "".join(
                b.get("text", "") for b in data["content"] if b.get("type") == "text"
            )
        except (KeyError, TypeError) as e:
            raise ProviderError("پاسخ سرویس شکل منتظره را نداشت.") from e

    raise ProviderError(f"گویش «{provider.dialect}» پیاده‌سازی نشده است.")


def probe(*, provider_id: str, api_key: str, model: str, base_url: str = "") -> dict:
    """
    آزمایش کلید — یک پرسش کوچک که فقط می‌سنجد ارتباط و کلید و مدل درست‌اند.

    چرا لازم است: بدون آن، کاربر کلید را ذخیره می‌کند و تازه وسط اولین پرسش
    واقعی می‌فهمد جایی ایراد دارد.
    """
    reply = complete(
        provider_id=provider_id, api_key=api_key, model=model, base_url=base_url,
        system="پاسخ را دقیقاً در یک کلمه بده.",
        user="بگو: سلام",
        max_tokens=64, timeout=45,
    )
    return {"ok": True, "reply": (reply or "").strip()[:120]}
