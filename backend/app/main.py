"""
سرور کاوشگر پایگاه داده.

پوسته‌ای نازک روی core/ — هیچ منطق کاوشی این‌جا نیست؛ هر مسیر یک تابع
هسته را صدا می‌زند. اجرای مستقیم:

    python3 -m app.main        →  http://127.0.0.1:8321
"""

from __future__ import annotations

import asyncio
import os
import sqlite3
import sys
from contextlib import closing
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.console import setup as setup_console                 # noqa: E402
from app.crashlog import breadcrumb, fatal_guard               # noqa: E402
from app.paths import (bundle_root, data_root,               # noqa: E402
                       kb_fingerprint, seed_data_dir)
from core import indexer                                      # noqa: E402
from core.search import KnowledgeBase                         # noqa: E402
from core.writer import KnowledgeWriter                       # noqa: E402

# پیش از هر خروجی: بدون این، اولین پیام فارسی روی کنسول ویندوز برنامه را
# با UnicodeEncodeError می‌کُشد و سرور اصلاً بالا نمی‌آید.
setup_console()

BUNDLE = bundle_root()
DATA = data_root()

KB_ROOT = Path(os.environ.get("KB_ROOT", DATA / "kb"))
INDEX = Path(os.environ.get("KB_INDEX", DATA / "index" / "kb.sqlite"))
INSTANCE = Path(os.environ.get("KB_INSTANCE", DATA / "instances" / "live"))
STATIC_DIR = Path(os.environ.get("STATIC_DIR", BUNDLE / "static"))

breadcrumb(DATA, f"شروع — بسته: {BUNDLE}")


def _build_index() -> None:
    """ساخت ایندکس از kb/ — درون همین فرایند، بدون زیرفرایند."""
    indexer.build(KB_ROOT, INDEX, INSTANCE if INSTANCE.exists() else None)
    # اثر انگشت دانشی که این ایندکس از رویش ساخته شد، داخل خودش می‌ماند تا
    # اجرای بعدی بداند چیزی عوض شده یا نه.
    # closing لازم است: «with» روی اتصال sqlite فقط تراکنش را می‌بندد، نه خود
    # اتصال را. اتصالِ باز روی ویندوز فایل را قفل نگه می‌دارد و بازسازی بعدی
    # را — در همین اجرا — با PermissionError می‌خواباند.
    with closing(sqlite3.connect(INDEX)) as db, db:
        db.execute("INSERT OR REPLACE INTO meta VALUES ('kb_fingerprint', ?)",
                   (kb_fingerprint(KB_ROOT) if KB_ROOT.is_dir() else "",))


def _index_is_stale() -> str | None:
    """
    چرا ایندکس باید دوباره ساخته شود — یا None اگر تازه است.

    پیش از این فقط «وجود ندارد» بررسی می‌شد. نتیجه‌اش این بود که کاربرِ
    به‌روزرسانی‌شده ایندکسِ نسخهٔ قبلی را نگه می‌داشت، در حالی که کدِ تازه از
    جدول‌هایی می‌پرسد که در آن ایندکس وجود ندارند — و هر بازکردن جدول با خطای
    «no such table» به ۵۰۰ می‌خورد. این دقیقاً همان چیزی بود که کاربر دید.
    """
    if not INDEX.exists():
        return f"ایندکس یافت نشد؛ ساخت از {KB_ROOT}"
    try:
        with closing(sqlite3.connect(f"file:{INDEX}?mode=ro", uri=True)) as db:
            meta = dict(db.execute("SELECT key, value FROM meta").fetchall())
    except sqlite3.Error:
        return "ایندکس خوانده نشد؛ بازسازی"
    if meta.get("schema_version") != indexer.SCHEMA_VERSION:
        return "ساختار ایندکس برای نسخهٔ قبلی برنامه است؛ بازسازی"
    if meta.get("kb_fingerprint") != _kb_fingerprint:
        return "دانش پایه به‌روز شده؛ بازسازی ایندکس"
    return None


# هرچه پیش از این نقطه می‌آید فقط مسیر می‌سازد؛ از این‌جا به بعد است که
# دیسک لمس می‌شود و می‌تواند بیفتد — پس از همین‌جا زیر چتر گزارش می‌رود.
_kb_fingerprint = ""
with fatal_guard(DATA, "آماده‌سازی دانش و ایندکس"):
    seed_data_dir(DATA, BUNDLE)
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    _kb_fingerprint = kb_fingerprint(KB_ROOT) if KB_ROOT.is_dir() else ""
    _stale = _index_is_stale()
    if _stale:
        print(f"{_stale} — یک بار و چند ثانیه…", flush=True)
        _build_index()

    kb = KnowledgeBase(INDEX)
    writer = KnowledgeWriter(KB_ROOT)
breadcrumb(DATA, "دانش و ایندکس آماده شد")
INDEX_STATE: dict = {"building": False, "last": None, "log": ""}

app = FastAPI(title="کاوشگر پایگاه داده", docs_url="/api/docs")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])


class KnowledgeIn(BaseModel):
    kind: str            # table | enum | join
    payload: dict


# ═══════════════ سلامت ═══════════════

@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "kb": kb.stats(), "index": str(INDEX),
            "built_at": INDEX_STATE["last"]}


# ═══════════════ کاوش ═══════════════

@app.get("/api/search")
def search(
    q: str = "",
    limit: int = Query(80, ge=1, le=500),
    schema: str | None = None,
    dataStatus: str = "all",
    fieldType: str | None = None,
    minRows: int | None = None,
    maxRows: int | None = None,
    sortBy: str = "score",
    sortOrder: str = "desc",
) -> dict:
    hits = kb.search_tables(
        query=q, limit=limit, schema=schema, data_status=dataStatus,
        field_type=fieldType, min_rows=minRows, max_rows=maxRows,
        sort_by=sortBy, sort_order=sortOrder,
    )
    return {"count": len(hits), "results": [{
        "full_name": h.full_name, "title_fa": h.title_fa, "n_cols": h.n_cols,
        "row_count": h.row_count, "has_data": h.has_data,
        "in_live_db": h.in_live_db, "score": round(h.score, 2), "why": h.why,
        "matched_columns": h.matched_columns or None,
    } for h in hits]}


@app.get("/api/columns")
def search_columns(q: str, limit: int = Query(30, ge=1, le=200)) -> dict:
    return {"results": kb.search_columns(q, limit=limit)}


@app.get("/api/schemas")
def schemas() -> dict:
    return {"schemas": kb.schemas()}


@app.get("/api/lookups")
def lookups(
    q: str = "",
    module: str = "",
    limit: int = Query(400, ge=1, le=2000),
) -> dict:
    return {
        "types": kb.lookups(q=q, module=module, limit=limit),
        "modules": kb.lookup_modules(),
    }


@app.get("/api/lookup/{lookup_type}")
def lookup(lookup_type: str) -> dict:
    found = kb.lookup(lookup_type)
    if found is None:
        raise HTTPException(404, f"نوع کد و شرحی «{lookup_type}» پیدا نشد.")
    return found


@app.get("/api/schema/{schema}/graph")
def schema_graph(
    schema: str,
    includeExternal: bool = True,
    onlyWithData: bool = False,
    maxNodes: int = Query(75, ge=5, le=300),
) -> dict:
    graph = kb.schema_graph(schema, include_external=includeExternal,
                            only_with_data=onlyWithData, max_nodes=maxNodes)
    if not graph["nodes"]:
        raise HTTPException(404, f"اسکیمای «{schema}» جدولی با این شرایط ندارد.")
    return graph


@app.get("/api/table/{full_name}")
def table(full_name: str) -> dict:
    t = kb.get_table(full_name)
    if t is None:
        raise HTTPException(404, f"جدول «{full_name}» پیدا نشد.")
    indexed_cols = sorted({c for i in t.indexes for c in i["columns"] if c})
    schema, _, name = t.full_name.partition(".")
    return {
        "full_name": t.full_name, "schema": schema, "table_name": name or t.full_name,
        "title_fa": t.title_fa, "description_fa": t.description_fa, "kind": t.kind,
        "row_count": t.row_count, "has_data": t.has_data, "in_live_db": t.in_live_db,
        "primary_key": t.primary_key,
        "columns": t.columns,
        "enums": t.enums,
        "indexes": t.indexes,
        "indexed_columns": indexed_cols,
        "warnings": t.warnings,
        "outgoing": [j.to_dict() for j in t.outgoing],
        "incoming": [j.to_dict() for j in t.incoming],
        "schema_neighbors": kb.schema_neighbors(t.full_name),
        "entity": kb.entity_for(t.full_name),
    }


@app.get("/api/joinpath")
def joinpath(
    source: str, target: str,
    maxHops: int = Query(4, ge=1, le=6),
    verifiedOnly: bool = False,
) -> dict:
    steps = kb.find_join_path(source, target, max_hops=maxHops,
                              verified_only=verifiedOnly)
    if steps is None:
        return {"found": False, "steps": [],
                "warning": f"مسیری بین «{source}» و «{target}» در گراف دانش پیدا نشد."}
    return {"found": True, "steps": [s.to_dict() for s in steps],
            "warning": kb.path_warning(steps) or ""}


@app.get("/api/neighbours/{full_name}")
def neighbours(full_name: str, limit: int = Query(40, ge=1, le=200)) -> dict:
    return {"results": kb.neighbours(full_name, limit=limit)}


# ═══════════════ ثبت دانش ═══════════════

@app.post("/api/knowledge")
def knowledge(body: KnowledgeIn) -> dict:
    handlers = {"table": writer.record_table, "enum": writer.record_enum,
                "join": writer.record_join}
    handler = handlers.get(body.kind)
    if handler is None:
        raise HTTPException(400, f"نوع دانش «{body.kind}» شناخته نشد.")
    try:
        message = handler(**body.payload)
    except TypeError as e:
        raise HTTPException(400, f"پارامترهای نادرست: {e}") from e
    except Exception as e:
        raise HTTPException(400, str(e)) from e
    # منبع حقیقت YAML است، ولی همان تغییر بی‌درنگ روی ایندکس زنده هم می‌نشیند
    # تا کاربر نتیجهٔ کار خودش را فوراً در جست‌وجو ببیند.
    try:
        kb.apply_learned(body.kind, body.payload)
        applied = True
    except Exception:
        applied = False

    return {"ok": True, "message": message, "applied": applied,
            "note": "" if applied else "برای اعمال در جست‌وجو، ایندکس را بازسازی کنید."}


@app.post("/api/index/rebuild")
async def rebuild_index() -> dict:
    """
    بازسازی ایندکس پس از ثبت دانش.

    بدون این، دانشی که ثبت می‌کنید در جست‌وجو ظاهر نمی‌شود —
    چون ایندکس مصنوعی مشتق است، نه منبع حقیقت.
    """
    if INDEX_STATE["building"]:
        return {"ok": False, "error": "بازسازی هم‌اکنون در جریان است."}
    INDEX_STATE["building"] = True

    # ساخت ایندکس چند ثانیه CPU می‌برد؛ در اجراکنندهٔ جداگانه می‌رود تا حلقهٔ
    # رویداد قفل نشود. اتصال هم باید بسته شود، وگرنه ویندوز اجازهٔ جایگزینی
    # فایلِ باز را نمی‌دهد.
    try:
        kb.close()
        await asyncio.get_running_loop().run_in_executor(None, _build_index)
        kb.reload()          # پیش از خواندن آمار، وگرنه روی اتصال بسته می‌افتیم
        INDEX_STATE["last"] = datetime.now().isoformat(timespec="seconds")
        INDEX_STATE["log"] = "ایندکس با موفقیت از kb/ بازساخته شد."
        return {"ok": True, "log": INDEX_STATE["log"], "at": INDEX_STATE["last"],
                "kb": kb.stats()}
    except Exception as e:
        kb.reload()
        return {"ok": False, "error": str(e)}
    finally:
        INDEX_STATE["building"] = False


@app.get("/api/index/state")
def index_state() -> dict:
    return {**INDEX_STATE, "path": str(INDEX)}


# ═══════════════ سرو کردن بیلد فرانت‌اند ═══════════════

if STATIC_DIR.is_dir():
    ASSETS = STATIC_DIR / "assets"
    if ASSETS.is_dir():
        app.mount("/assets", StaticFiles(directory=ASSETS), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        """هر مسیر ناشناخته به index.html می‌رسد تا اپ تک‌صفحه‌ای بالا بیاید."""
        candidate = (STATIC_DIR / path).resolve()
        # مسیر باید داخل پوشهٔ استاتیک بماند — جلوگیری از خواندن فایل‌های بیرون
        if path and candidate.is_file() and candidate.is_relative_to(STATIC_DIR.resolve()):
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")


def _free_port(host: str, preferred: int) -> int:
    """
    اولین پورت آزاد از پورت دلخواه به بعد.

    یک برنامهٔ رومیزی نباید فقط به این دلیل که پورتی اشغال است بالا نیاید؛
    اگر ۸۳۲۱ گرفته باشد، ۸۳۲۲ را امتحان می‌کند و همین‌طور تا بیست پورت بعد.
    """
    import socket

    for candidate in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind((host, candidate))
                return candidate
            except OSError:
                continue
    raise SystemExit(f"هیچ پورت آزادی بین {preferred} تا {preferred + 19} پیدا نشد.")


def main() -> None:
    import threading
    import webbrowser

    import uvicorn

    host = os.environ.get("HOST", "127.0.0.1")
    port = _free_port(host, int(os.environ.get("PORT", "8321")))
    url = f"http://{host}:{port}"

    print()
    print("  کاوشگر پایگاه داده  ·  DataBase Kavosh")
    print("  " + "─" * 42)
    print(f"  {url}")
    print(f"  داده‌ها: {DATA}")
    print("  برای بستن برنامه، این پنجره را ببندید یا Ctrl+C بزنید.")
    print()

    if os.environ.get("KAVOSH_NO_BROWSER") != "1":
        # مرورگر با کمی تأخیر باز می‌شود تا به صفحهٔ «اتصال برقرار نشد» نخورد
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    with fatal_guard(DATA, "اجرای سرور"):
        main()
