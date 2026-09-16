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

    def tail(path: Path, n: int = 4000) -> str:
        try:
            return path.read_text(encoding="utf-8", errors="replace")[-n:]
        except OSError:
            return "(بدون خروجی)"

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
        "base": base, "llm": f"http://127.0.0.1:{llm_port}/v1", "data": data,
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


def _ask(base: str, question: str) -> list[dict]:
    req = urllib.request.Request(
        f"{base}/api/assistant/ask",
        data=json.dumps({"question": question}).encode(), method="POST",
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
    assert "retrieve" in kinds, detail
    assert "verify" in kinds, detail

    result = events[-1]
    assert result["type"] == "result", detail
    assert result["check"]["ok"] is True
    assert "Employee" in result["sql"] and "Employees" not in result["sql"]
    # یعنی حلقهٔ اصلاح واقعاً به کار افتاده، نه اینکه از اول درست بوده
    assert result["attempts"] >= 2

    verifies = [e for e in events if e["type"] == "verify" and "ok" in e]
    assert any(not v["ok"] for v in verifies), "اولین بازبینی باید ناموفق باشد"


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
