"""
تنظیمات کاربر — و نگه‌داری کلیدهای API.

کلید API مثل رمز عبور است و با آن رفتار می‌شود:

  • کنار دادهٔ کاربر ذخیره می‌شود، نه در مخزن و نه در بستهٔ برنامه.
  • روی سیستم‌های یونیکسی فایل ۰۶۰۰ می‌شود تا کاربران دیگرِ همان دستگاه
    نتوانند بخوانندش.
  • هرگز به رابط کاربری برنگردانده نمی‌شود. آنچه رابط می‌بیند فقط «کلید
    ثبت شده یا نه» و چهار رقم آخر است. یعنی حتی اگر صفحه جایی لو برود،
    کلید لو نمی‌رود.
  • هرگز در لاگ و در گزارش خطا نوشته نمی‌شود.

هر کلید زیر شناسهٔ ارائه‌دهنده‌اش می‌نشیند، پس کاربر می‌تواند چند کلید
داشته باشد و بین‌شان جابه‌جا شود بی‌آنکه هر بار دوباره واردشان کند.
"""

from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path

from core import providers

FILE_NAME = "settings.json"

DEFAULTS = {
    "provider": "openrouter",
    "model": "",
    "base_url": "",
    "max_attempts": 4,
}


def _path(data_root: Path) -> Path:
    return Path(data_root) / FILE_NAME


def _read_raw(data_root: Path) -> dict:
    path = _path(data_root)
    if not path.exists():
        return {}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return doc if isinstance(doc, dict) else {}


def _write_raw(data_root: Path, doc: dict) -> None:
    path = _path(data_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    if sys.platform != "win32":
        # پیش از جابه‌جایی مجوز را می‌بندیم تا حتی یک لحظه فایلِ باز نماند
        os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    os.replace(tmp, path)


def _hint(key: str) -> str:
    """چهار نویسهٔ آخر — تنها چیزی از کلید که بیرون می‌رود."""
    key = (key or "").strip()
    return f"…{key[-4:]}" if len(key) >= 4 else ("…" if key else "")


def load(data_root: Path) -> dict:
    """تنظیمات کامل، شاملِ کلیدها. فقط برای استفادهٔ داخلی سرور."""
    doc = _read_raw(data_root).get("assistant") or {}
    merged = {**DEFAULTS, **{k: v for k, v in doc.items() if k != "keys"}}
    merged["keys"] = doc.get("keys") if isinstance(doc.get("keys"), dict) else {}
    if not merged.get("model"):
        provider = providers.BY_ID.get(merged["provider"])
        merged["model"] = provider.default_model if provider else ""
    return merged


def public(data_root: Path) -> dict:
    """
    آنچه رابط کاربری حق دیدنش را دارد — بدون هیچ کلیدی.

    این تابع عمداً جداست و نه یک پرچم روی load(): با دو تابع، فرستادن
    تصادفیِ کلید به بیرون مستلزم صدا زدن تابعِ اشتباه است، نه فراموش‌کردن
    یک پارامتر.
    """
    conf = load(data_root)
    keys = conf.get("keys") or {}
    return {
        "provider": conf["provider"],
        "model": conf["model"],
        "base_url": conf.get("base_url", ""),
        "max_attempts": int(conf.get("max_attempts") or DEFAULTS["max_attempts"]),
        "providers": [
            {**p, "has_key": bool(keys.get(p["id"])), "key_hint": _hint(keys.get(p["id"], ""))}
            for p in providers.catalog()
        ],
    }


def save(data_root: Path, patch: dict) -> dict:
    """
    به‌روزرسانی جزئی. کلید فقط وقتی عوض می‌شود که صریحاً فرستاده شده باشد،
    پس ذخیرهٔ دوبارهٔ تنظیمات کلیدِ قبلی را پاک نمی‌کند.
    """
    doc = _read_raw(data_root)
    conf = load(data_root)
    keys = dict(conf.get("keys") or {})

    if "provider" in patch:
        pid = str(patch["provider"])
        if pid not in providers.BY_ID:
            raise ValueError(f"ارائه‌دهندهٔ «{pid}» شناخته نشد.")
        conf["provider"] = pid
        if "model" not in patch:
            conf["model"] = providers.BY_ID[pid].default_model
    for field in ("model", "base_url"):
        if field in patch:
            conf[field] = str(patch[field] or "").strip()
    if "max_attempts" in patch:
        conf["max_attempts"] = max(1, min(8, int(patch["max_attempts"])))

    # «api_key» تهی یعنی پاک کن؛ نبودنش یعنی دست نزن
    if "api_key" in patch:
        target = str(patch.get("key_provider") or conf["provider"])
        # نیم‌فاصله و نشانهٔ جهتِ کپی‌شده از متن فارسی در سرآیند HTTP جا نمی‌شود
        value = providers.clean_key(patch["api_key"])
        if value:
            keys[target] = value
        else:
            keys.pop(target, None)

    doc["assistant"] = {
        "provider": conf["provider"], "model": conf["model"],
        "base_url": conf.get("base_url", ""),
        "max_attempts": conf["max_attempts"], "keys": keys,
    }
    _write_raw(data_root, doc)
    return public(data_root)


def active(data_root: Path) -> dict:
    """ارائه‌دهنده و کلیدِ فعال برای اجرای دستیار."""
    conf = load(data_root)
    provider_id = conf["provider"]
    return {
        "provider_id": provider_id,
        "api_key": (conf.get("keys") or {}).get(provider_id, ""),
        "model": conf["model"],
        "base_url": conf.get("base_url", ""),
        "max_attempts": int(conf.get("max_attempts") or DEFAULTS["max_attempts"]),
    }
