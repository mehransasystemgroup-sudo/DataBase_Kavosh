"""
حلقه‌ی یادگیری — ثبت دانش جدید در KB.

اصل طراحی: ادعای کاربر معتبر است، ادعای مدل نیست.
    • آنچه شما می‌گویید → مستقیم در KB با source=stated_by_user
    • آنچه مدل استنتاج می‌کند → صف بازبینی، تا شما تأیید کنید

هر نوشتن در audit.log ثبت می‌شود تا اگر دانش بدی وارد شد،
بتوان ردیابی و برگرداندش.

⚠️ بعد از هر ثبت، ایندکس باید بازسازی شود تا تغییر در جست‌وجو دیده شود.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

import yaml


class KnowledgeWriter:
    def __init__(self, kb_root: Path, author: str = "user"):
        self.kb = Path(kb_root)
        self.author = author
        self.audit = self.kb / "audit.log"

    # ─────────────── کمکی ───────────────

    def _load(self, path: Path) -> dict:
        if path.exists():
            return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return {}

    def _save(self, path: Path, data: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=200),
            encoding="utf-8",
        )

    def _log(self, action: str, target: str, payload: dict) -> None:
        entry = {
            "at": datetime.now().isoformat(timespec="seconds"),
            "by": self.author,
            "action": action,
            "target": target,
            "payload": payload,
        }
        with self.audit.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # ─────────────── ثبت معنای جدول ───────────────

    def record_table(
        self,
        full_name: str,
        title_fa: str | None = None,
        description_fa: str | None = None,
        kind: str | None = None,
        grain: str | None = None,
        gotcha: str | None = None,
    ) -> str:
        schema, table = full_name.split(".", 1)
        path = self.kb / "semantics" / f"{schema}.yaml"
        doc = self._load(path)
        doc.setdefault("schema", schema)
        doc.setdefault("tables", [])

        entry = next((t for t in doc["tables"] if t["name"] == table), None)
        created = entry is None
        if created:
            entry = {"name": table}
            doc["tables"].append(entry)

        changed = []
        for key, val in (("title_fa", title_fa), ("description_fa", description_fa),
                         ("kind", kind), ("grain", grain)):
            if val:
                entry[key] = val
                changed.append(key)

        if gotcha:
            entry.setdefault("gotchas", [])
            if gotcha not in entry["gotchas"]:
                entry["gotchas"].append(gotcha)
                changed.append("gotchas")

        if not changed:
            return "چیزی برای ثبت داده نشد."

        entry["source"] = "stated_by_user"
        entry["confidence"] = "high"
        entry["updated_at"] = date.today().isoformat()
        entry["updated_by"] = self.author
        entry["_manual"] = True          # مانع بازنویسی در ingest بعدی

        doc["tables"].sort(key=lambda t: t["name"])
        self._save(path, doc)
        self._log("record_table", full_name, {"fields": changed})

        verb = "ثبت شد" if created else "به‌روزرسانی شد"
        return (f"✔ {full_name} {verb} — فیلدهای: {'، '.join(changed)}\n"
                f"   برای دیده‌شدن در جست‌وجو، ایندکس را بازسازی کنید.")

    # ─────────────── ثبت معنای enum ───────────────

    def record_enum(
        self, full_name: str, column: str, value: str, label_fa: str,
        note: str | None = None,
    ) -> str:
        schema, table = full_name.split(".", 1)
        path = self.kb / "enums" / f"{schema}.yaml"
        doc = self._load(path)
        doc.setdefault("schema", schema)
        doc.setdefault("enums", [])

        entry = next((e for e in doc["enums"]
                      if e["table"] == table and e["column"] == column), None)
        if entry is None:
            entry = {"table": table, "column": column, "values": []}
            doc["enums"].append(entry)

        val = next((v for v in entry["values"] if str(v["value"]) == str(value)), None)
        if val is None:
            val = {"value": str(value)}
            entry["values"].append(val)

        old = val.get("label_fa")
        val["label_fa"] = label_fa
        val["source"] = "stated_by_user"
        val["confidence"] = "high"
        val["updated_at"] = date.today().isoformat()
        if note:
            val["note"] = note

        entry["values"].sort(key=lambda v: (len(str(v["value"])), str(v["value"])))
        self._save(path, doc)
        self._log("record_enum", f"{full_name}.{column}",
                  {"value": value, "label_fa": label_fa, "was": old})

        if old and old != label_fa:
            return (f"✔ {full_name}.{column} = {value} → «{label_fa}»\n"
                    f"   ⚠️ مقدار قبلی «{old}» بود و جایگزین شد.")
        return f"✔ {full_name}.{column} = {value} → «{label_fa}»"

    # ─────────────── ثبت مسیر JOIN ───────────────

    def record_join(
        self, from_table: str, from_col: str, to_table: str, to_col: str,
        note: str | None = None,
    ) -> str:
        path = self.kb / "joins" / "user-verified.yaml"
        doc = self._load(path)
        doc.setdefault("note", "مسیرهای JOIN که کاربر تأیید کرده — بر استنتاج اولویت دارند.")
        doc.setdefault("edges", [])

        src = f"{from_table}.{from_col}"
        edge = next((e for e in doc["edges"] if e["from"] == src), None)
        if edge is None:
            edge = {"from": src}
            doc["edges"].append(edge)

        edge.update({
            "to": f"{to_table}.{to_col}",
            "source": "stated_by_user",
            "confidence": "high",
            "verified": True,
            "updated_at": date.today().isoformat(),
        })
        if note:
            edge["note"] = note

        doc["edges"].sort(key=lambda e: e["from"])
        self._save(path, doc)
        self._log("record_join", src, {"to": edge["to"]})
        return f"✔ مسیر ثبت شد: {src} → {edge['to']}"
