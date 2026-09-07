"""
سرور کاوشگر پایگاه داده.

پوسته‌ای نازک روی core/ — هیچ منطق کاوشی این‌جا نیست؛ هر مسیر یک تابع
هسته را صدا می‌زند. اجرای مستقیم:

    python3 -m app.main        →  http://127.0.0.1:8321
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
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

from core.search import KnowledgeBase          # noqa: E402
from core.writer import KnowledgeWriter        # noqa: E402

KB_ROOT = Path(os.environ.get("KB_ROOT", ROOT / "kb"))
INDEX = Path(os.environ.get("KB_INDEX", ROOT / "index" / "kb.sqlite"))
INSTANCE = Path(os.environ.get("KB_INSTANCE", ROOT / "instances" / "live"))
STATIC_DIR = Path(os.environ.get("STATIC_DIR", ROOT / "static"))
BUILD_SCRIPT = ROOT / "scripts" / "build_index.py"


def _ensure_index() -> None:
    """ایندکس مصنوعی مشتق است — اگر نبود، همین‌جا از kb/ ساخته می‌شود."""
    if INDEX.exists():
        return
    print(f"ایندکس یافت نشد؛ ساخت از {KB_ROOT} …", flush=True)
    cmd = [sys.executable, str(BUILD_SCRIPT), "--kb", str(KB_ROOT), "--out", str(INDEX)]
    if INSTANCE.exists():
        cmd += ["--instance", str(INSTANCE)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"✖ ساخت ایندکس شکست خورد:\n{result.stdout}\n{result.stderr}")
    print(result.stdout, flush=True)


_ensure_index()

kb = KnowledgeBase(INDEX)
writer = KnowledgeWriter(KB_ROOT)
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
    return {"ok": True, "message": message,
            "note": "برای اعمال در جست‌وجو، ایندکس را بازسازی کنید."}


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

    def run() -> subprocess.CompletedProcess:
        cmd = [sys.executable, str(BUILD_SCRIPT), "--kb", str(KB_ROOT),
               "--out", str(INDEX)]
        if INSTANCE.exists():
            cmd += ["--instance", str(INSTANCE)]
        return subprocess.run(cmd, capture_output=True, text=True, timeout=900)

    try:
        r = await asyncio.get_running_loop().run_in_executor(None, run)
        INDEX_STATE["log"] = (r.stdout or r.stderr)[-1500:]
        INDEX_STATE["last"] = datetime.now().isoformat(timespec="seconds")
        if r.returncode != 0:
            return {"ok": False, "error": INDEX_STATE["log"]}
        kb.reload()
        return {"ok": True, "log": INDEX_STATE["log"], "at": INDEX_STATE["last"],
                "kb": kb.stats()}
    except Exception as e:
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


def main() -> None:
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"),
                port=int(os.environ.get("PORT", "8321")))


if __name__ == "__main__":
    main()
