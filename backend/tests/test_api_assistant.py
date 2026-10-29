"""
آزمون مسیر کامل دستیار — از HTTP تا جریان رویداد.

سرور واقعی در یک زیرفرایند بالا می‌آید و با یک سرویس مدلِ ساختگی حرف می‌زند.
پس آنچه آزموده می‌شود دقیقاً همان چیزی است که روی دستگاه کاربر اجرا می‌شود:
تنظیمات، ذخیرهٔ کلید، جریان SSE، و حلقهٔ اصلاح.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def _send(url: str, payload: dict, method: str = "PUT") -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method=method,
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    """
    سرور واقعی و سرویس مدلِ ساختگی، هر دو در زیرفرایند.

    خروجی هر دو به *فایل* می‌رود نه به لوله. لولهٔ خوانده‌نشده وقتی پر شود،
    فرایندِ نویسنده را بی‌صدا متوقف می‌کند — و بافر لوله روی ویندوز به‌مراتب
    کوچک‌تر از لینوکس است، یعنی آزمونی که این‌جا سبز است آن‌جا بی‌دلیل
    می‌خوابد. با فایل، نه سقفی هست و نه موقع شکست چیزی از دست می‌رود.
    """
    data = tmp_path_factory.mktemp("data")
    logs = tmp_path_factory.mktemp("logs")
    llm_port, api_port = _free_port(), _free_port()

    api_log = logs / "api.log"
    llm_log = logs / "llm.log"

    def tail(path: Path, n: int = 4000) -> str:
        try:
            return path.read_text(encoding="utf-8", errors="replace")[-n:]
        except OSError:
            return "(بدون خروجی)"

    llm = subprocess.Popen(
        [sys.executable, str(BACKEND / "tests" / "fake_llm.py"), str(llm_port)],
        stdout=llm_log.open("wb"), stderr=subprocess.STDOUT,
    )
    env = {
        **os.environ,
        "KAVOSH_DATA_DIR": str(data),
        "KAVOSH_NO_BROWSER": "1",
        "KAVOSH_NO_PAUSE": "1",
        "PORT": str(api_port),
        "PYTHONPATH": str(BACKEND),
    }
    api = subprocess.Popen(
        [sys.executable, "-m", "app.main"], cwd=str(BACKEND), env=env,
        stdout=api_log.open("wb"), stderr=subprocess.STDOUT,
    )

    # سرویس مدلِ ساختگی باید *ثابت شود* که بالاست. اگر نباشد، شکستش چند لایه
    # پایین‌تر و با پیامی بی‌ربط بیرون می‌زند («به سرویس مدل وصل نشدیم») و
    # دنبال علت در جای اشتباه می‌گردیم.
    llm_base = f"http://127.0.0.1:{llm_port}/v1"
    for _ in range(40):
        if llm.poll() is not None:
            pytest.fail(f"سرویس مدل ساختگی افتاد:\n{tail(llm_log)}")
        try:
            _send(f"{llm_base}/chat/completions", {"messages": []}, method="POST")
            break
        except (urllib.error.URLError, OSError, TimeoutError):
            time.sleep(0.5)
    else:
        pytest.fail(f"سرویس مدل ساختگی بالا نیامد:\n{tail(llm_log)}")

    base = f"http://127.0.0.1:{api_port}"
    deadline = time.time() + 300           # اولین اجرا ایندکس را می‌سازد
    while time.time() < deadline:
        if api.poll() is not None:
            pytest.fail(f"سرور بالا نیامد:\n{tail(api_log)}")
        try:
            _get(f"{base}/api/health")
            break
        except (urllib.error.URLError, OSError, TimeoutError):
            time.sleep(2)
    else:
        pytest.fail(f"سرور در زمان مقرر بالا نیامد.\n{tail(api_log)}")

    yield {
        "base": base, "llm": llm_base, "data": data,
        "api_log": api_log, "llm_log": llm_log, "tail": tail,
    }

    for proc in (api, llm):
        proc.terminate()
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_settings_start_empty_and_list_providers(server):
    conf = _get(f"{server['base']}/api/settings")
    ids = {p["id"] for p in conf["providers"]}
    assert {"openai", "gemini", "openrouter", "anthropic", "custom"} <= ids
    assert all(not p["has_key"] for p in conf["providers"])


def test_api_key_is_stored_but_never_returned(server):
    """
    مهم‌ترین قاعدهٔ امنیتی این بخش: کلید می‌رود، برنمی‌گردد.
    """
    secret = "sk-test-ABCD1234SECRETVALUE"
    saved = _send(f"{server['base']}/api/settings", {
        "provider": "custom", "base_url": server["llm"],
        "model": "fake-model", "api_key": secret,
    })
    blob = json.dumps(saved, ensure_ascii=False)
    assert secret not in blob
    assert "SECRETVALUE" not in blob

    custom = next(p for p in saved["providers"] if p["id"] == "custom")
    assert custom["has_key"] is True
    assert custom["key_hint"] == "…VALUE"[-5:] or custom["key_hint"].startswith("…")

    # و در خواندن بعدی هم برنگردد
    again = json.dumps(_get(f"{server['base']}/api/settings"), ensure_ascii=False)
    assert secret not in again


def test_saving_other_fields_keeps_the_key(server):
    _send(f"{server['base']}/api/settings", {"max_attempts": 3})
    conf = _get(f"{server['base']}/api/settings")
    custom = next(p for p in conf["providers"] if p["id"] == "custom")
    assert custom["has_key"] is True
    assert conf["max_attempts"] == 3


def _ask(base: str, question: str, **extra) -> list[dict]:
    req = urllib.request.Request(
        f"{base}/api/assistant/ask",
        data=json.dumps({"question": question, **extra}).encode(), method="POST",
        headers={"content-type": "application/json"},
    )
    events = []
    with urllib.request.urlopen(req, timeout=300) as r:
        for raw in r:
            line = raw.decode("utf-8").strip()
            if line.startswith("data:"):
                events.append(json.loads(line[5:]))
    return events


def test_full_run_repairs_a_weak_models_mistake(server):
    """
    سرویس ساختگی عمداً دور اول «HCM3.Employees» می‌دهد. مسیر کامل باید ایراد
    را بگیرد، بازخورد بدهد، و با کوئریِ تأییدشده تمام شود.
    """
    events = _ask(server["base"], "فهرست کارمندان")
    kinds = [e["type"] for e in events]
    # گزارشِ کامل در خودِ پیام شکست: با فهرست بریده، تشخیص از راه دور ممکن
    # نیست و باید یک دور دیگر CI سوزاند تا فقط ببینیم چه شد.
    story = "\n".join(f"  {e['type']}: {e.get('message', '')}" for e in events)
    detail = f"\nرویدادها:\n{story}\n\nخروجی سرور:\n{server['tail'](server['api_log'])}"
    assert "understand" in kinds, detail
    assert "retrieve" in kinds, detail
    assert "verify" in kinds, detail

    result = events[-1]
    assert result["type"] == "result", detail
    assert result["check"]["ok"] is True
    assert "Employee" in result["sql"] and "Employees" not in result["sql"]
    # یعنی حلقهٔ اصلاح واقعاً به کار افتاده، نه اینکه از اول درست بوده
    assert result["attempts"] >= 2
    assert result["intent"]["goal"] == "فهرست شناسهٔ کارمندان"

    verifies = [e for e in events if e["type"] == "verify" and "ok" in e]
    assert any(not v["ok"] for v in verifies), "اولین بازبینی باید ناموفق باشد"


def test_pinned_tables_reach_the_assistant(server):
    """جدولی که کاربر از صفحهٔ جدول سنجاق کرده، همیشه در زمینهٔ پاسخ هست."""
    events = _ask(server["base"], "فهرست کارمندان", tables=["FIN3.Voucher", "NOPE.Missing"])
    result = events[-1]
    assert result["type"] == "result", events
    assert result["tables"][0] == "FIN3.Voucher"
    assert "NOPE.Missing" not in result["tables"]


def test_empty_question_is_refused(server):
    with pytest.raises(urllib.error.HTTPError) as err:
        _send(f"{server['base']}/api/assistant/ask", {"question": "  "}, method="POST")
    assert err.value.code == 400


def test_check_endpoint_validates_without_any_model(server):
    """
    بازبین باید بدون کلید و بدون مدل هم کار کند — هم برای کوئری خودِ کاربر،
    و هم به‌عنوان تنها راهِ اطمینان از اینکه گویش T-SQL در بسته بار می‌شود.
    """
    good = _send(f"{server['base']}/api/assistant/check",
                 {"sql": "SELECT EmployeeID FROM HCM3.Employee"}, method="POST")
    assert good["ok"] is True
    assert good["tables"] == ["HCM3.Employee"]

    bad = _send(f"{server['base']}/api/assistant/check",
                {"sql": "SELECT * FROM HCM3.NoSuchTable"}, method="POST")
    assert bad["ok"] is False
    assert any(f["code"] == "unknown_table" for f in bad["findings"])


def test_retired_model_is_replaced_from_the_live_list(server):
    """
    مدلِ ذخیره‌شده بازنشسته شده (همان چیزی که با gemini-2.0-flash پیش آمد).
    دستیار باید از فهرست زندهٔ سرویس جایگزین بگیرد، ادامه دهد، و آن را ذخیره کند.
    """
    _send(f"{server['base']}/api/settings", {
        "provider": "custom", "base_url": server["llm"], "model": "retired-model",
    })
    events = _ask(server["base"], "فهرست کارمندان")
    story = "\n".join(f"  {e['type']}: {e.get('message', '')}" for e in events)
    detail = f"\nرویدادها:\n{story}\n\nخروجی سرور:\n{server['tail'](server['api_log'])}"
    assert events[-1]["type"] == "result", detail
    assert events[-1]["model"] == "gpt-9-mini", detail
    assert any(e["type"] == "model" for e in events), detail
    assert _get(f"{server['base']}/api/settings")["model"] == "gpt-9-mini"


def test_connection_test_suggests_a_live_model(server):
    probe = _send(f"{server['base']}/api/settings/test", {
        "provider": "custom", "base_url": server["llm"], "model": "retired-model",
    }, method="POST")
    assert probe["ok"] is True, probe
    assert probe["model"] == "gpt-9-mini"
    assert probe["replaced"] == "retired-model"
    assert "gpt-9" in probe["models"] and "text-embedding-3-small" not in probe["models"]


# ═══════════════ مرز امنیتی سرور محلی ═══════════════

def _status(url: str, *, method: str = "GET", payload: dict | None = None,
            headers: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        url, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"content-type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers)


def test_other_websites_cannot_reach_the_local_server(server):
    """
    صفحه‌ای دیگر در همان مرورگر نباید بتواند تنظیمات و کلید را دست بزند.
    پیش از 3.6.0 CORS برای همه باز بود.
    """
    base = server["base"]
    status, headers = _status(f"{base}/api/settings", method="OPTIONS", headers={
        "origin": "https://evil.example", "access-control-request-method": "PUT"})
    assert "access-control-allow-origin" not in {k.lower() for k in headers}

    status, _ = _status(f"{base}/api/settings/test", method="POST",
                        payload={"provider": "openai", "base_url": "https://evil.example"},
                        headers={"origin": "https://evil.example"})
    assert status == 403

    # DNS rebinding: همان سرور، با نام میزبان بیگانه
    status, _ = _status(f"{base}/api/health", headers={"host": "evil.example"})
    assert status == 403

    # خودِ برنامه (همان مبدأ) و ابزارهای بی‌Origin کار می‌کنند
    status, _ = _status(f"{base}/api/assistant/check", method="POST",
                        payload={"sql": "SELECT 1"}, headers={"origin": base})
    assert status == 200


def test_knowledge_cannot_escape_kb_or_invent_tables(server):
    base = server["base"]
    for payload in (
        {"full_name": "../../../escape", "title_fa": "x"},
        {"full_name": "NOPE.NoSuchTable", "title_fa": "x"},
        {"full_name": "nodot", "title_fa": "x"},
    ):
        status, _ = _status(f"{base}/api/knowledge", method="POST",
                            payload={"kind": "table", "payload": payload})
        assert status == 400, payload
    assert not list(Path(server["data"]).parent.rglob("escape.yaml"))

    status, _ = _status(f"{base}/api/knowledge", method="POST", payload={
        "kind": "enum", "payload": {"full_name": "FIN3.Voucher", "column": "NoSuchCol",
                                    "value": "1", "label_fa": "x"}})
    assert status == 400
