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
