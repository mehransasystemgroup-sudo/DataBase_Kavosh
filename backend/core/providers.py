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

import fnmatch
import json
import re
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
    # نام مدل‌ها زود کهنه می‌شوند: gemini-2.0-flash که پیش‌فرض بود در ۱۴۰۵
    # بازنشسته شد و دستیار با «مدل پیدا نشد» از کار افتاد. برای همین هرجا
    # سرویس نامِ «همیشه‌تازه» دارد همان پیش‌فرض است، و برای بقیه اگر مدل
    # نبود، فهرست زندهٔ مدل‌ها از خودِ سرویس گرفته و جایگزین انتخاب می‌شود
    # (heal_model). این فهرست‌ها فقط پیشنهادِ اولیه‌اند.
    Provider(
        id="openai", name="OpenAI", dialect="openai",
        base_url="https://api.openai.com/v1",
        default_model="gpt-4.1-mini",
        models=("gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "o4-mini"),
        key_url="https://platform.openai.com/api-keys",
    ),
    Provider(
        id="gemini", name="Google Gemini", dialect="gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta",
        default_model="gemini-flash-latest",
        models=("gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest"),
        key_url="https://aistudio.google.com/apikey",
    ),
    Provider(
        id="openrouter", name="OpenRouter", dialect="openai",
        base_url="https://openrouter.ai/api/v1",
        default_model="openrouter/auto",
        models=("openrouter/auto",),
        key_url="https://openrouter.ai/keys",
        note="از یک کلید به ده‌ها مدل دسترسی می‌دهد؛ «openrouter/auto» خودش مدل مناسب را برمی‌گزیند.",
    ),
    Provider(
        id="anthropic", name="Anthropic Claude", dialect="anthropic",
        base_url="https://api.anthropic.com/v1",
        default_model="claude-sonnet-5-5",
        models=("claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"),
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


class ModelNotFound(ProviderError):
    """سرویس در دسترس است ولی این نام مدل را نمی‌شناسد — معمولاً مدلِ بازنشسته."""


# نشانه‌های «مدل نیست» در پیام سرویس‌ها. کد وضعیت به‌تنهایی کافی نیست:
# OpenRouter برای مدلِ ناموجود ۴۰۰ می‌دهد و ۴۰۴ هم می‌تواند از نشانی اشتباه باشد.
_MODEL_MISSING = (
    "model_not_found", "does not exist", "is not found", "not found for api",
    "not a valid model", "no endpoints found", "unknown model", "not supported for generatecontent",
    "no longer available", "has been deprecated", "is deprecated", "not_found_error",
)
# محدودیت جغرافیایی؛ بدون این، کاربر ساعت‌ها دنبال ایراد کلید می‌گردد.
_REGION_BLOCK = (
    "unsupported_country", "location is not supported", "not available in your country",
    "unsupported country", "not available in your region", "region is not supported",
    "request not allowed",
)


def _detail_text(body: str) -> str:
    """پیام خودِ سرویس از بدنهٔ خطا — هر سه گویش آن را در error.message می‌گذارند."""
    try:
        doc = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return (body or "").strip()[:300]
    err = doc.get("error") if isinstance(doc, dict) else None
    if isinstance(err, dict):
        msg = err.get("message") or err.get("code") or ""
        meta = err.get("metadata") or {}
        raw = meta.get("raw") if isinstance(meta, dict) else ""
        return f"{msg} {raw or ''}".strip()[:300]
    if isinstance(err, str):
        return err[:300]
    if isinstance(doc, dict) and doc.get("message"):
        return str(doc["message"])[:300]
    return "" if isinstance(doc, (dict, list)) else (body or "").strip()[:300]


def http_error(status: int, body: str, model: str = "") -> ProviderError:
    """
    خطای HTTP سرویس → پیام فارسیِ دقیق.

    پیش‌تر هر ۴۰۳ «کلید پذیرفته نشد» خوانده می‌شد؛ در حالی که از ایران رایج‌ترین
    ۴۰۳ محدودیت جغرافیایی است و کاربر بی‌جهت کلیدش را عوض می‌کرد. حالا پیام
    خودِ سرویس خوانده و همراه خطا نشان داده می‌شود.
    """
    detail = _detail_text(body)
    low = f"{detail} {body or ''}".lower()
    tail = f"\nپیام سرویس: {detail}" if detail else ""
    if any(k in low for k in _REGION_BLOCK):
        return ProviderError(
            "این سرویس از منطقهٔ جغرافیایی شما درخواست نمی‌پذیرد (محدودیت کشور)، نه "
            "ایراد کلید. از ارائه‌دهندهٔ دیگری مثل OpenRouter، یا سرویس محلی "
            "(Ollama / LM Studio) استفاده کنید." + tail
        )
    if status == 401 or "invalid api key" in low or "api_key_invalid" in low or "invalid x-api-key" in low:
        return ProviderError("کلید API پذیرفته نشد. کلید را در تنظیمات بررسی کنید." + tail)
    if status == 402 or (status != 429 and any(k in low for k in ("insufficient", "credit"))):
        return ProviderError("اعتبار یا سهمیهٔ حساب در این سرویس کافی نیست." + tail)
    if status in (400, 404) and any(k in low for k in _MODEL_MISSING):
        return ModelNotFound(
            f"مدل «{model}» در این سرویس وجود ندارد یا بازنشسته شده است." + tail
        )
    if status == 404:
        return ProviderError("نشانی سرویس یا نام مدل پیدا نشد؛ در تنظیمات بررسی کنید." + tail)
    if status == 403:
        return ProviderError("سرویس دسترسی را رد کرد." + tail)
    if status == 429:
        return ProviderError("سرویس فعلاً محدودیت نرخ گذاشته؛ کمی بعد دوباره تلاش کنید." + tail)
    if 500 <= status < 600:
        return ProviderError(f"سرویسِ مدل خطای داخلی داد ({status})." + tail)
    return ProviderError(f"سرویسِ مدل خطای {status} داد." + tail)


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


def _request(url: str, payload: dict | None, headers: dict, timeout: int, model: str = "") -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url, data=body, method="POST" if payload is not None else "GET",
        headers={"content-type": "application/json", **headers},
    )
    try:
        with _opener(url).open(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:4000]
        except Exception:                                    # noqa: BLE001
            pass
        raise http_error(e.code, detail, model) from e
    except urllib.error.URLError as e:
        raise ProviderError(
            "به سرویس مدل وصل نشدیم. اتصال اینترنت و نشانی سرویس را بررسی کنید."
        ) from e
    except socket.timeout as e:
        raise ProviderError("پاسخ مدل در زمان مقرر نرسید.") from e
    except json.JSONDecodeError as e:
        raise ProviderError("پاسخ سرویس قابل خواندن نبود.") from e


def _post(url: str, payload: dict, headers: dict, timeout: int, model: str = "") -> dict:
    return _request(url, payload, headers, timeout, model)


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
            timeout, model,
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
            timeout, model,
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
            timeout, model,
        )
        try:
            return "".join(
                b.get("text", "") for b in data["content"] if b.get("type") == "text"
            )
        except (KeyError, TypeError) as e:
            raise ProviderError("پاسخ سرویس شکل منتظره را نداشت.") from e

    raise ProviderError(f"گویش «{provider.dialect}» پیاده‌سازی نشده است.")


def list_models(*, provider_id: str, api_key: str, base_url: str = "", timeout: int = 30) -> list[str]:
    """فهرست زندهٔ مدل‌های گفت‌وگوی این سرویس، با همین کلید."""
    provider = BY_ID.get(provider_id)
    if provider is None:
        raise ProviderError(f"ارائه‌دهندهٔ «{provider_id}» شناخته نشد.")
    root = (base_url or provider.base_url).rstrip("/")

    if provider.dialect == "gemini":
        ids: list[str] = []
        token = ""
        for _ in range(10):                       # صفحه‌بندی؛ سقف برای ایمنی
            url = f"{root}/models?pageSize=1000" + (f"&pageToken={token}" if token else "")
            data = _request(url, None, {"x-goog-api-key": api_key}, timeout)
            for m in data.get("models") or []:
                if "generateContent" in (m.get("supportedGenerationMethods") or []):
                    ids.append(str(m.get("name", "")).removeprefix("models/"))
            token = data.get("nextPageToken") or ""
            if not token:
                break
        return [i for i in ids if i]

    if provider.dialect == "anthropic":
        data = _request(f"{root}/models?limit=1000", None,
                        {"x-api-key": api_key, "anthropic-version": "2023-06-01"}, timeout)
        return [str(m["id"]) for m in data.get("data") or [] if m.get("id")]

    data = _request(f"{root}/models", None,
                    {"authorization": f"Bearer {api_key}"} if api_key else {}, timeout)
    return [str(m["id"]) for m in data.get("data") or [] if isinstance(m, dict) and m.get("id")]


# مدل‌هایی که برای نوشتن کوئری به کار نمی‌آیند — صوت، تصویر، جاسازی و …
_NOT_CHAT = (
    "embed", "tts", "audio", "image", "vision-preview", "realtime", "transcribe",
    "whisper", "dall-e", "moderation", "search", "live", "native-audio", "computer-use",
    "aqa", "learnlm", "gemma", "babbage", "davinci", "instruct", "robotics",
)
# ترتیب ترجیح برای هر سرویس: اول «همیشه‌تازه»، بعد خانوادهٔ سریعِ ارزان.
_PREFER = {
    "openai": ("gpt-*-mini", "gpt-*"),
    "gemini": ("gemini-flash-latest", "gemini-*-flash", "gemini-pro-latest", "gemini-*-pro"),
    "anthropic": ("claude-sonnet-*", "claude-*"),
    "openrouter": ("openrouter/auto",),
}


def _version(model_id: str) -> tuple:
    return tuple(int(n) for n in re.findall(r"\d+", model_id)[:4])


def pick_model(provider_id: str, ids: list[str]) -> str:
    """از فهرست زنده، مناسب‌ترین مدل برای کوئری‌نویسی را برمی‌گزیند."""
    usable = [i for i in ids if not any(k in i.lower() for k in _NOT_CHAT)]
    stable = [i for i in usable if not any(k in i.lower() for k in ("preview", "exp", "-lite", "nano"))]
    for pool in (stable, usable):
        for pattern in _PREFER.get(provider_id, ()):
            hits = [i for i in pool if fnmatch.fnmatchcase(i, pattern)]
            if hits:
                return max(hits, key=lambda i: (_version(i), -len(i)))
    return (stable or usable or ids or [""])[0]


def heal_model(*, provider_id: str, api_key: str, base_url: str, failed: str) -> str:
    """
    مدل ذخیره‌شده دیگر نیست → جایگزینی از فهرست زندهٔ همان سرویس.

    کاربر نباید برای بازنشسته‌شدنِ یک مدل در آن سوی دنیا، برنامه را
    به‌روز کند یا نام مدل تازه را از جایی پیدا کند.
    """
    ids = list_models(provider_id=provider_id, api_key=api_key, base_url=base_url)
    choice = pick_model(provider_id, [i for i in ids if i != failed])
    if not choice:
        raise ProviderError(
            f"مدل «{failed}» در این سرویس وجود ندارد و سرویس مدل دیگری هم معرفی نکرد."
        )
    return choice


def probe(*, provider_id: str, api_key: str, model: str, base_url: str = "") -> dict:
    """
    آزمایش کلید — یک پرسش کوچک که فقط می‌سنجد ارتباط و کلید و مدل درست‌اند.

    چرا لازم است: بدون آن، کاربر کلید را ذخیره می‌کند و تازه وسط اولین پرسش
    واقعی می‌فهمد جایی ایراد دارد. اگر فقط نام مدل کهنه باشد، همین‌جا جایگزین
    پیشنهاد می‌شود، و فهرست زندهٔ مدل‌ها هم برای انتخاب برمی‌گردد.
    """
    def once(name: str) -> str:
        return complete(
            provider_id=provider_id, api_key=api_key, model=name, base_url=base_url,
            system="پاسخ را دقیقاً در یک کلمه بده.",
            user="بگو: سلام",
            max_tokens=64, timeout=45,
        )

    replaced = ""
    try:
        reply = once(model)
    except ModelNotFound:
        replaced, model = model, heal_model(
            provider_id=provider_id, api_key=api_key, base_url=base_url, failed=model,
        )
        reply = once(model)
    try:
        models = list_models(provider_id=provider_id, api_key=api_key, base_url=base_url)
        models = [m for m in models if not any(k in m.lower() for k in _NOT_CHAT)][:300]
    except ProviderError:
        models = []
    return {"ok": True, "reply": (reply or "").strip()[:120], "model": model,
            "replaced": replaced, "models": models}
