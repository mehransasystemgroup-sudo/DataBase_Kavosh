"""
سرویس ساختگیِ سازگار با OpenAI — برای آزمودن مسیر کامل بدون کلید واقعی.

چرا لازم است: دستیار از رابط کاربری تا سرویس مدل چند لایه دارد — تنظیمات،
جریان رویداد (SSE)، حلقهٔ اصلاح. اگر فقط منطق را با مدل ساختگیِ درون‌فرایندی
بیازماییم، خودِ آن لایه‌ها هرگز آزموده نمی‌شوند. این سرویس همان شکل HTTP را
دارد، پس مسیر واقعی طی می‌شود.

رفتارش عمداً «مدل ضعیف» است: دور اول نام جدول را جمع می‌بندد تا بازبین ایراد
بگیرد و حلقهٔ اصلاح واقعاً به کار بیفتد.
"""

from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):        # noqa: D102 — سکوت در خروجی آزمون
        pass

    def _json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):                    # noqa: N802
        # فهرست مدل‌ها، همان شکل OpenAI. «retired-model» در آن نیست — مثل
        # مدلی که سرویس بازنشسته کرده است.
        if self.path.rstrip("/").endswith("/models"):
            self._json(200, {"object": "list", "data": [
                {"id": "text-embedding-3-small"}, {"id": "gpt-9-mini"}, {"id": "gpt-9"},
            ]})
        else:
            self._json(404, {"error": {"message": "not found"}})

    def do_POST(self):                   # noqa: N802 — نام را http.server می‌خواهد
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        text = json.dumps(body, ensure_ascii=False)

        # مدلِ بازنشسته: همان پاسخی که OpenAI برای مدلِ ناموجود می‌دهد
        if body.get("model") == "retired-model":
            self._json(404, {"error": {
                "message": "The model `retired-model` does not exist or you do not have access to it.",
                "type": "invalid_request_error", "code": "model_not_found",
            }})
            return

        # تصمیم فقط از روی محتوای پرامپت گرفته می‌شود، نه از شمارندهٔ درخواست.
        # با شمارنده، ترتیب یا تعداد تماس‌ها که عوض شود آزمون بی‌ربط می‌افتد و
        # علتش هم پیدا نیست؛ این‌طور رفتار هر تماس مستقل و قابل‌پیش‌بینی است.
        good = "```sql\nSELECT [e].[EmployeeID] FROM [HCM3].[Employee] AS [e]\n```\nشناسهٔ کارمندان."
        if "هنوز کوئری نمی‌نویسی" in text:
            reply = "هدف: فهرست شناسهٔ کارمندان\nنوع: کوئری\nکلیدواژه‌ها: کارمند، Employee"
        elif "انتخاب کن" in text:
            reply = "HCM3.Employee"
        elif "ناموجود" in text:
            # مدلی که تا آخر اشتباه می‌ماند — برای آزمودن مسیر «تأیید نشد»
            reply = "```sql\nSELECT x.NoSuchColumn FROM HCM3.Employees AS x\n```"
        elif "ایرادهایی که بازبین گرفت" in text:
            reply = good                       # با دیدن بازخورد، تصحیح می‌کند
        else:
            # اولین نگارش: اشتباهِ کلاسیک مدل ضعیف — جمع‌بستن نام جدول
            reply = "```sql\nSELECT e.EmployeeID FROM HCM3.Employees AS e\n```"

        payload = {"choices": [{"message": {"role": "assistant", "content": reply}}]}
        raw = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def serve(port: int) -> HTTPServer:
    server = HTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


if __name__ == "__main__":
    # بدون این، اولین چاپِ غیر-ASCII روی ویندوز UnicodeEncodeError می‌دهد و
    # فرایند می‌میرد — و چون سرور در نخِ daemon است، بی‌صدا با آن می‌رود.
    # آن وقت آزمون «به سرویس مدل وصل نشدیم» می‌گیرد و علت جای دیگری به نظر
    # می‌رسد. همان درسی که یک بار در age_index.py گرفتیم.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:                                # noqa: BLE001
                pass

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8999
    serve(port)
    print(f"fake llm listening on {port}", flush=True)
    threading.Event().wait()
