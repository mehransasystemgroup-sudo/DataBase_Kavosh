"""
سرور کاوشگر پایگاه داده.

پوسته‌ای نازک روی core/ — هیچ منطق کاوشی این‌جا نیست؛ هر مسیر یک تابع
هسته را صدا می‌زند. اجرای مستقیم:

    python3 -m app.main        →  http://127.0.0.1:8321
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
from contextlib import closing
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.console import setup as setup_console                 # noqa: E402
from app.ports import bind_free_port                           # noqa: E402
from app.crashlog import breadcrumb, fatal_guard               # noqa: E402
from app.version import VERSION                                # noqa: E402
from app import settings as user_settings                      # noqa: E402
from core import assistant, providers                          # noqa: E402
from core.sqlcheck import SchemaIndex, check_sql                # noqa: E402
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
    # pid می‌گوید *کدام* فرایند جواب داد؛ بدون آن، آزمون نصب نمی‌تواند نسخهٔ
    # تازه را از نسخهٔ قدیمیِ هنوز باز تشخیص دهد.
    return {"ok": True, "version": VERSION, "kb": kb.stats(), "index": str(INDEX),
            "built_at": INDEX_STATE["last"], "pid": os.getpid()}


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


# ═══════════════ تنظیمات و دستیار کوئری‌نویسی ═══════════════


class SettingsIn(BaseModel):
    provider: str | None = None
    model: str | None = None
    base_url: str | None = None
    max_attempts: int | None = None
    api_key: str | None = None
    key_provider: str | None = None


class AskIn(BaseModel):
    question: str
    # پرسش‌وپاسخ‌های قبلیِ همین گفت‌وگو، تا «حالا فقط امسال» معنا داشته باشد.
    # شکل و اندازه‌اش در assistant.clean_history مهار می‌شود.
    history: list[dict] = []


@app.get("/api/settings")
def get_settings() -> dict:
    return user_settings.public(DATA)


@app.put("/api/settings")
def put_settings(body: SettingsIn) -> dict:
    # exclude_unset مهم است: «نفرستادن کلید» با «فرستادن کلید خالی» یکی نیست.
    # اولی یعنی دست نزن، دومی یعنی پاکش کن.
    patch = body.model_dump(exclude_unset=True)
    try:
        return user_settings.save(DATA, patch)
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e)) from e


@app.post("/api/settings/test")
async def test_settings(body: SettingsIn) -> dict:
    """
    آزمایش کلید پیش از ذخیره.

    کلیدِ فرستاده‌شده ذخیره نمی‌شود؛ اگر نیامده باشد، از کلیدِ ذخیره‌شده
    استفاده می‌شود. پس کاربر هم می‌تواند کلید تازه را بیازماید و هم کلید
    فعلی را، بی‌آنکه چیزی عوض شود.
    """
    patch = body.model_dump(exclude_unset=True)
    current = user_settings.active(DATA)
    provider_id = patch.get("provider") or current["provider_id"]
    key = patch.get("api_key")
    if not key:
        stored = user_settings.load(DATA).get("keys") or {}
        key = stored.get(provider_id, "")
    model = patch.get("model") or current["model"]
    if provider_id != current["provider_id"] and not patch.get("model"):
        target = providers.BY_ID.get(provider_id)
        model = target.default_model if target else model
    base_url = patch.get("base_url", current["base_url"])

    try:
        result = await asyncio.to_thread(
            providers.probe, provider_id=provider_id, api_key=key,
            model=model, base_url=base_url or "",
        )
        return {**result, "provider": provider_id}
    except providers.ProviderError as e:
        return {"ok": False, "error": str(e), "provider": provider_id, "model": model}


class CheckIn(BaseModel):
    sql: str


@app.post("/api/assistant/check")
def assistant_check(body: CheckIn) -> dict:
    """
    بازبینی یک کوئری در برابر ساختار — بدون هیچ مدلی.

    همان بازبینی‌ای که خروجی دستیار از آن رد می‌شود، این‌جا مستقیم در دسترس
    است: کوئریِ خودِ کاربر را هم می‌شود سنجید. کلید API نمی‌خواهد چون هیچ
    مدلی درگیر نیست.

    این مسیر ضمناً تنها راهی است که آزمون دود می‌تواند مطمئن شود گویش T-SQL
    در نسخهٔ بسته‌بندی‌شده هم بار می‌شود: sqlglot گویش‌ها را در زمان اجرا
    import می‌کند، پس صرفِ بالا آمدن برنامه چیزی را ثابت نمی‌کند.
    """
    return check_sql(body.sql or "", SchemaIndex(INDEX)).to_dict()


@app.post("/api/assistant/ask")
async def assistant_ask(body: AskIn) -> StreamingResponse:
    """
    پرسش به دستیار، با گزارش زندهٔ مراحل.

    چرا جریانی: مسیرِ رسیدن به جواب چند مرحله دارد و با مدل‌های ضعیف‌تر
    عمداً طولانی می‌شود (هر بازبینیِ ناموفق یک دور اصلاح می‌آورد). اگر کاربر
    فقط یک چرخنده ببیند، فکر می‌کند برنامه گیر کرده؛ وقتی می‌بیند «بازبینی
    ۲ از ۴»، می‌فهمد دارد کار می‌کند و چرا طول می‌کشد.
    """
    question = (body.question or "").strip()
    if not question:
        raise HTTPException(400, "پرسش خالی است.")

    conf = user_settings.active(DATA)
    if not conf["api_key"] and conf["provider_id"] != "custom":
        raise HTTPException(400, "هنوز کلید API ثبت نشده — از تنظیمات اضافه‌اش کنید.")

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def emit(kind: str, message: str, data: dict) -> None:
        loop.call_soon_threadsafe(
            queue.put_nowait, {"type": kind, "message": message, **(data or {})}
        )

    def ask(system: str, user: str) -> str:
        try:
            return providers.complete(
                provider_id=conf["provider_id"], api_key=conf["api_key"],
                model=conf["model"], base_url=conf["base_url"],
                system=system, user=user,
            )
        except providers.ModelNotFound:
            # مدلِ ذخیره‌شده بازنشسته شده: جایگزین از فهرست زندهٔ سرویس، ذخیره
            # برای دفعه‌های بعد، و یک بار تلاش دوباره — بی‌آنکه کاربر کاری کند.
            old = conf["model"]
            conf["model"] = providers.heal_model(
                provider_id=conf["provider_id"], api_key=conf["api_key"],
                base_url=conf["base_url"], failed=old,
            )
            user_settings.save(DATA, {"model": conf["model"]})
            emit("model", f"مدل {old} دیگر در دسترس نیست؛ با {conf['model']} ادامه می‌دهیم.",
                 {"model": conf["model"], "replaced": old})
            return providers.complete(
                provider_id=conf["provider_id"], api_key=conf["api_key"],
                model=conf["model"], base_url=conf["base_url"],
                system=system, user=user,
            )

    def work() -> dict:
        index = SchemaIndex(INDEX)
        draft = assistant.run(
            question=question, kb=kb, index=index, ask=ask, emit=emit,
            max_attempts=conf["max_attempts"], history=body.history,
        )
        return {
            "type": "result", "kind": draft.kind, "sql": draft.sql,
            "note": draft.note, "attempts": draft.attempts,
            "tables": draft.tables, "joins": draft.joins, "intent": draft.intent,
            "check": draft.check.to_dict() if draft.check else None,
            "model": conf["model"], "provider": conf["provider_id"],
        }

    async def stream():
        task = asyncio.create_task(asyncio.to_thread(work))
        try:
            while True:
                drain = asyncio.create_task(queue.get())
                done, _ = await asyncio.wait(
                    {drain, task}, return_when=asyncio.FIRST_COMPLETED
                )
                if drain in done:
                    yield f"data: {json.dumps(drain.result(), ensure_ascii=False)}\n\n"
                    continue
                drain.cancel()
                while not queue.empty():
                    event = queue.get_nowait()
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                try:
                    payload = task.result()
                except providers.ProviderError as e:
                    payload = {"type": "error", "message": str(e)}
                except Exception as e:                       # noqa: BLE001
                    payload = {"type": "error", "message": f"خطای غیرمنتظره: {e}"}
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                return
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(stream(), media_type="text/event-stream", headers={
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
    })


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

# ═══════════════ رابط کاربری ═══════════════
#
# چرا این‌جا صریحاً دربارهٔ حافظهٔ نهان حرف می‌زنیم:
#
# برنامه همیشه روی یک نشانی ثابت بالا می‌آید (http://127.0.0.1:8321) و کاربر
# آن را در مرورگر معمولی خودش باز می‌کند. تا دیروز هیچ هدر Cache-Control
# فرستاده نمی‌شد؛ در نبود آن، مرورگر مجاز است خودش حدس بزند فایل تا کِی
# تازه است. نتیجه‌اش این بود: کاربر نسخهٔ تازه را نصب می‌کرد، برنامه بالا
# می‌آمد، ولی مرورگر همان index.html قدیمی را از حافظه‌اش برمی‌داشت — و چون
# آن فایل به نام دارایی‌های قدیمی اشاره می‌کند که آن‌ها هم در حافظه‌اند، کل
# برنامهٔ قبلی بدون یک درخواست به سرور رندر می‌شد. از بیرون: «نصب کردم ولی
# هیچ چیز عوض نشد.»
#
# قاعده استاندارد است و دو خط دارد:
#   • index.html هرگز بی‌پرسش از حافظه خوانده نشود (no-cache). ETag هست، پس
#     پرسش معمولاً یک ۳۰۴ کوچک است، نه دانلود دوباره.
#   • دارایی‌های /assets که نامشان هش محتواست، تا یک سال معتبرند؛ محتوایشان
#     هرگز عوض نمی‌شود، فقط نامشان.
NO_STORE_HTML = "no-cache, must-revalidate"
IMMUTABLE = "public, max-age=31536000, immutable"


class _HashedAssets(StaticFiles):
    """دارایی‌های هش‌دار — همیشه‌تازه، چون نامشان با محتوا عوض می‌شود."""

    def file_response(self, *args, **kwargs):  # noqa: D102
        response = super().file_response(*args, **kwargs)
        response.headers["cache-control"] = IMMUTABLE
        return response


if STATIC_DIR.is_dir():
    ASSETS = STATIC_DIR / "assets"
    if ASSETS.is_dir():
        app.mount("/assets", _HashedAssets(directory=ASSETS), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        """هر مسیر ناشناخته به index.html می‌رسد تا اپ تک‌صفحه‌ای بالا بیاید."""
        candidate = (STATIC_DIR / path).resolve()
        # مسیر باید داخل پوشهٔ استاتیک بماند — جلوگیری از خواندن فایل‌های بیرون
        if path and candidate.is_file() and candidate.is_relative_to(STATIC_DIR.resolve()):
            # این‌ها هش ندارند (favicon.svg و مانندش)، پس مثل html رفتار
            # می‌کنند: با تغییر نسخه باید عوض شوند، و شدند.
            return FileResponse(candidate, headers={"cache-control": NO_STORE_HTML})
        return FileResponse(STATIC_DIR / "index.html",
                            headers={"cache-control": NO_STORE_HTML})


def main() -> None:
    import threading
    import webbrowser

    import uvicorn

    host = os.environ.get("HOST", "127.0.0.1")
    sock = bind_free_port(host, int(os.environ.get("PORT", "8321")))
    port = sock.getsockname()[1]
    base = f"http://{host}:{port}"

    # ?v=نسخه فقط یک برچسب نیست؛ کارِ مشخصی می‌کند.
    #
    # کاربری که نسخهٔ قبلی را روی همین نشانی باز کرده، index.html قدیمی را در
    # حافظهٔ نهان مرورگرش دارد — و چون آن روزها بدون Cache-Control فرستاده
    # می‌شد، مرورگر مجاز است بی‌آنکه از سرور بپرسد همان را نشان دهد. هدرهای
    # درستِ امروز آن حافظهٔ *از پیش پرشده* را پاک نمی‌کنند. ولی نشانیِ تازه
    # کلید تازه‌ای در حافظه است، پس مرورگر مجبور است یک بار واقعاً بپرسد — و
    # همان یک بار کافی است تا از این به بعد قاعدهٔ درست حاکم شود.
    url = f"{base}/?v={VERSION}"

    print()
    print("  کاوشگر پایگاه داده  ·  DataBase Kavosh")
    print("  " + "─" * 42)
    print(f"  {base}")
    print(f"  داده‌ها: {DATA}")
    print("  برای بستن برنامه، این پنجره را ببندید یا Ctrl+C بزنید.")
    print()

    if os.environ.get("KAVOSH_NO_BROWSER") != "1":
        # مرورگر با کمی تأخیر باز می‌شود تا به صفحهٔ «اتصال برقرار نشد» نخورد
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    # سوکتِ از پیش گرفته‌شده به uvicorn می‌رود، نه شمارهٔ پورت — دلیلش در ports.py
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="warning"))
    server.run(sockets=[sock])


if __name__ == "__main__":
    with fatal_guard(DATA, "اجرای سرور"):
        main()
