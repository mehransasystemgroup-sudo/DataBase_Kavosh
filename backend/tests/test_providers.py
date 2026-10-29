"""نگاشت خطای سرویس‌ها و انتخاب مدل جایگزین — بدون شبکه."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import providers  # noqa: E402


def err(status, message, code=""):
    return providers.http_error(status, json.dumps({"error": {"message": message, "code": code}}), "m")


def test_region_block_is_not_reported_as_a_bad_key():
    for e in (
        err(403, "Country, region, or territory not supported", "unsupported_country_region_territory"),
        err(400, "User location is not supported for the API use."),
    ):
        assert "منطقه" in str(e) and "کلید API پذیرفته نشد" not in str(e)


def test_retired_model_is_recognised_in_every_dialect():
    assert isinstance(err(404, "The model `x` does not exist", "model_not_found"), providers.ModelNotFound)
    assert isinstance(err(404, "models/gemini-2.0-flash is not found for API version v1beta"),
                      providers.ModelNotFound)
    assert isinstance(providers.http_error(404, json.dumps(
        {"type": "error", "error": {"type": "not_found_error", "message": "model: claude-x"}}), "m"),
        providers.ModelNotFound)
    assert isinstance(err(400, "google/gemini-2.0-flash-001 is not a valid model ID"), providers.ModelNotFound)


def test_bad_key_and_service_message_are_shown():
    e = err(401, "Incorrect API key provided")
    assert "کلید API پذیرفته نشد" in str(e) and "Incorrect API key" in str(e)


def test_pick_model_prefers_current_fast_chat_models():
    assert providers.pick_model("gemini", [
        "gemini-2.5-flash", "gemini-3.8-flash", "gemini-3.8-flash-lite", "gemini-3.9-flash-preview",
        "gemini-3.8-pro", "embedding-001", "gemini-3.8-flash-image",
    ]) == "gemini-3.8-flash"
    assert providers.pick_model("gemini", ["gemini-flash-latest", "gemini-3.8-flash"]) == "gemini-flash-latest"
    assert providers.pick_model("openai", ["gpt-4o", "gpt-5.2-mini", "gpt-5.2", "gpt-4o-mini-tts"]) == "gpt-5.2-mini"
    assert providers.pick_model("anthropic", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-sonnet-4-5"]) \
        == "claude-sonnet-5-5"
    assert providers.pick_model("openrouter", ["a/b", "openrouter/auto"]) == "openrouter/auto"


def _fake(monkeypatch, reply):
    sent = {}

    def fake(url, payload, headers, timeout, model=""):
        sent.update(url=url, payload=payload, headers=headers)
        return reply
    monkeypatch.setattr(providers, "_request", fake)
    return sent


def test_gemini_has_no_output_cap_so_thinking_cannot_eat_the_answer(monkeypatch):
    # Gemini 2.5+ فکر کردن را از maxOutputTokens کم می‌کند؛ سقف کوچکِ آزمایش اتصال
    # پاسخ بی‌متن می‌داد و «شکل منتظره را نداشت» نشان داده می‌شد.
    sent = _fake(monkeypatch, {"candidates": [{"content": {"parts": [
        {"text": "…", "thought": True}, {"text": "سلام"}]}, "finishReason": "STOP"}]})
    out = providers.complete(provider_id="gemini", api_key="k", model="models/gemini-flash-latest",
                             system="s", user="u", max_tokens=64)
    assert out == "سلام"
    assert "maxOutputTokens" not in sent["payload"]["generationConfig"]
    assert sent["url"].endswith("/models/gemini-flash-latest:generateContent")


def test_gemini_empty_answer_is_explained(monkeypatch):
    _fake(monkeypatch, {"candidates": [{"content": {"role": "model"}, "finishReason": "MAX_TOKENS"}]})
    try:
        providers.complete(provider_id="gemini", api_key="k", model="m", system="s", user="u")
    except providers.ProviderError as e:
        assert "سقف توکن" in str(e)
    else:
        raise AssertionError("باید خطا می‌داد")


def test_pasted_key_loses_invisible_characters(monkeypatch):
    sent = _fake(monkeypatch, {"candidates": [{"content": {"parts": [{"text": "x"}]}}]})
    providers.complete(provider_id="gemini", api_key="‏ AIza-abc_123‌\n",
                       model="m", system="s", user="u")
    assert sent["headers"]["x-goog-api-key"] == "AIza-abc_123"


def test_openai_reasoning_models_get_their_own_parameters(monkeypatch):
    sent = _fake(monkeypatch, {"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]})
    providers.complete(provider_id="openai", api_key="k", model="gpt-5.2-mini", system="s", user="u",
                       max_tokens=64)
    assert "temperature" not in sent["payload"] and "max_tokens" not in sent["payload"]
    assert sent["payload"]["max_completion_tokens"] > 64
    providers.complete(provider_id="openai", api_key="k", model="gpt-4.1-mini", system="s", user="u")
    assert sent["payload"]["temperature"] == 0 and "max_tokens" not in sent["payload"]
    providers.complete(provider_id="openrouter", api_key="k", model="openrouter/auto", system="s", user="u")
    assert sent["payload"]["max_tokens"] == 2000


def test_html_403_is_a_network_block_and_bad_gemini_key_is_named():
    e = providers.http_error(403, "<html><title>Error 403 (Forbidden)!!1</title><p>Your client does not "
                                  "have permission</p></html>")
    assert "کلید" in str(e) and "فیلترینگ" in str(e) and "<p>" not in str(e)
    e = err(400, "API key not valid. Please pass a valid API key.")
    assert "کلید API پذیرفته نشد" in str(e)


def test_fixed_providers_ignore_a_foreign_base_url():
    """کلیدِ سرویس‌های اصلی هرگز به نشانی دلخواه نمی‌رود؛ فقط سرویس محلی نشانی دلخواه دارد."""
    openai = providers.BY_ID["openai"]
    assert providers._root(openai, "https://evil.example/v1") == "https://api.openai.com/v1"
    custom = providers.BY_ID["custom"]
    assert providers._root(custom, "http://127.0.0.1:11434/v1/") == "http://127.0.0.1:11434/v1"
