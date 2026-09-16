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
    seen = 0
    lock = threading.Lock()

    def log_message(self, *args):        # noqa: D102 — سکوت در خروجی آزمون
        pass

    def do_POST(self):                   # noqa: N802 — نام را http.server می‌خواهد
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        text = json.dumps(body, ensure_ascii=False)

        with Handler.lock:
            Handler.seen += 1
            n = Handler.seen

        # واژهٔ کلیدی برای آزمودن مسیر شکست: مدلی که تا آخر اشتباه می‌ماند.
        # بدون این، مسیر «تأیید نشد» هرگز دیده نمی‌شود.
        if "ناموجود" in text:
            reply = ("```sql\nSELECT x.NoSuchColumn FROM HCM3.Employees AS x\n```"
                     if "انتخاب کن" not in text else "HCM3.Employee")
        elif "انتخاب کن" in text:
            reply = "HCM3.Employee"
        elif "ایرادهایی که بازبین گرفت" in text:
            reply = "```sql\nSELECT [e].[EmployeeID] FROM [HCM3].[Employee] AS [e]\n```\nشناسهٔ کارمندان."
        elif n <= 2:
            # اولین نگارش: اشتباهِ کلاسیکِ مدل ضعیف — جمع‌بستن نام جدول
            reply = "```sql\nSELECT e.EmployeeID FROM HCM3.Employees AS e\n```"
        else:
            reply = "```sql\nSELECT [e].[EmployeeID] FROM [HCM3].[Employee] AS [e]\n```"

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
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8999
    serve(port)
    print(f"سرویس ساختگی روی {port}", flush=True)
    threading.Event().wait()
