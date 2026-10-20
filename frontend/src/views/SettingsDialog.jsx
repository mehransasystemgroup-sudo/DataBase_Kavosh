import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Loader2, Settings, Trash2, XCircle } from "lucide-react";

import { errorMessage, http } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";

/*
  تنظیمات — فعلاً فقط دستیار کوئری‌نویسی، چون تنها بخشی است که پیکربندی
  می‌خواهد.

  چرا پنجره و نه یک تبِ جدا: تب‌ها فضای کار روزانه‌اند و کاربر ده‌ها بار در
  روز بینشان جابه‌جا می‌شود؛ تنظیمات را شاید ماهی یک بار باز کند. یک تبِ
  دائمی برای چنین چیزی، فضای گران را به کارِ ارزان می‌دهد.

  دربارهٔ کلید API: آنچه این صفحه از سرور می‌گیرد هرگز شامل خودِ کلید نیست —
  فقط «ثبت شده یا نه» و چهار نویسهٔ آخر. پس حتی اگر این صفحه جایی دیده شود،
  کلید از آن بیرون نمی‌آید.
*/

function ProviderCard({ provider, active, onPick }) {
  return (
    <button
      type="button"
      onClick={() => onPick(provider.id)}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-start transition-colors",
        active
          ? "border-brand/50 bg-brand/8"
          : "border-border bg-surface hover:border-brand/30 hover:bg-surfaceHover",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          active ? "border-brand bg-brand" : "border-borderStrong",
        )}
      >
        {active && <span className="h-1.5 w-1.5 rounded-full bg-brand-foreground" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-foreground">
            {provider.name}
          </span>
          {provider.has_key && (
            <Badge tone="ok" className="shrink-0">
              کلید {provider.key_hint}
            </Badge>
          )}
        </span>
        {provider.note && (
          <span className="mt-0.5 block text-[10.5px] leading-relaxed text-muted-foreground">
            {provider.note}
          </span>
        )}
      </span>
    </button>
  );
}

export default function SettingsDialog({ open, onOpenChange, onSaved }) {
  const [conf, setConf] = useState(null);
  const [picked, setPicked] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [attempts, setAttempts] = useState(4);
  const [apiKey, setApiKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState("");
  const [probe, setProbe] = useState(null);

  useEffect(() => {
    if (!open) return;
    setProbe(null);
    setApiKey("");
    http
      .get("/settings")
      .then(({ data }) => {
        setConf(data);
        setPicked(data.provider);
        setModel(data.model || "");
        setBaseUrl(data.base_url || "");
        setAttempts(data.max_attempts || 4);
      })
      .catch((e) => setConf({ error: errorMessage(e) }));
  }, [open]);

  const current = conf?.providers?.find((p) => p.id === picked);

  // عوض‌کردن ارائه‌دهنده باید مدلِ پیش‌فرض همان را بیاورد، وگرنه کاربر با نام
  // مدلی می‌ماند که برای سرویس قبلی بود و اولین پرسش با خطای «مدل پیدا نشد»
  // برمی‌گردد.
  const pick = (id) => {
    setPicked(id);
    setProbe(null);
    const next = conf?.providers?.find((p) => p.id === id);
    if (next) {
      setModel(next.default_model || "");
      setBaseUrl(next.editable_base_url ? next.base_url : "");
    }
  };

  const patch = (extra = {}) => ({
    provider: picked,
    model: model.trim(),
    base_url: current?.editable_base_url ? baseUrl.trim() : "",
    max_attempts: Number(attempts) || 4,
    ...extra,
  });

  const test = async () => {
    setBusy("test");
    setProbe(null);
    try {
      const body = patch(apiKey.trim() ? { api_key: apiKey.trim() } : {});
      const { data } = await http.post("/settings/test", body);
      setProbe(data);
    } catch (e) {
      setProbe({ ok: false, error: errorMessage(e) });
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      // کلید فقط وقتی فرستاده می‌شود که کاربر چیزی تایپ کرده باشد؛ وگرنه
      // ذخیرهٔ تنظیمات، کلیدِ ثبت‌شده را پاک می‌کرد.
      const body = patch(apiKey.trim() ? { api_key: apiKey.trim(), key_provider: picked } : {});
      const { data } = await http.put("/settings", body);
      setConf(data);
      setApiKey("");
      toast.success("تنظیمات ذخیره شد");
      onSaved?.(data);
      onOpenChange(false);
    } catch (e) {
      toast.error("ذخیره نشد", { description: errorMessage(e) });
    } finally {
      setBusy("");
    }
  };

  const clearKey = async () => {
    setBusy("clear");
    try {
      const { data } = await http.put("/settings", { api_key: "", key_provider: picked });
      setConf(data);
      setProbe(null);
      toast.success("کلید حذف شد");
      onSaved?.(data);
    } catch (e) {
      toast.error("حذف نشد", { description: errorMessage(e) });
    } finally {
      setBusy("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-brand-text" />
            تنظیمات
          </DialogTitle>
          <DialogDescription>
            دستیار کوئری‌نویسی برای کار کردن به یک کلید API نیاز دارد. کلید فقط
            روی همین دستگاه ذخیره می‌شود و جایی فرستاده نمی‌شود جز همان سرویسی
            که انتخاب می‌کنید.
          </DialogDescription>
        </DialogHeader>

        {conf?.error && (
          <p className="rounded-md border border-err/40 bg-err/10 px-3 py-2 text-[11.5px] text-err">
            {conf.error}
          </p>
        )}

        {!conf && !conf?.error && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {conf?.providers && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>ارائه‌دهندهٔ مدل</Label>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {conf.providers.map((p) => (
                  <ProviderCard
                    key={p.id}
                    provider={p}
                    active={p.id === picked}
                    onPick={pick}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="api-key">کلید API</Label>
              <div className="flex gap-1.5">
                {/* قلم مونو فقط برای خودِ کلید که لاتین است؛ روی متن راهنمای
                    فارسی، مونو گلیف ندارد و فاصله‌ها را می‌شکند. */}
                <div className="relative flex-1">
                  <Input
                    id="api-key"
                    dir="ltr"
                    type={reveal ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={
                      current?.has_key ? `ثبت‌شده ${current.key_hint}` : "کلید را بچسبانید"
                    }
                    className={cn("pe-9 text-[11.5px]", apiKey && "font-mono")}
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((v) => !v)}
                    aria-label={reveal ? "پنهان کردن" : "نمایش"}
                    className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {current?.has_key && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="حذف کلید ثبت‌شده"
                    onClick={clearKey}
                    disabled={busy === "clear"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {current?.key_url && (
                <a
                  href={current.key_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[10.5px] text-brand-text hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  گرفتن کلید از {current.name}
                </a>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="model">مدل</Label>
                <Input
                  id="model"
                  dir="ltr"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  list="model-suggestions"
                  className="font-mono text-[11.5px]"
                />
                <datalist id="model-suggestions">
                  {(current?.models || []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="attempts">سقف تلاش برای اصلاح</Label>
                <Input
                  id="attempts"
                  type="number"
                  min={1}
                  max={8}
                  value={attempts}
                  onChange={(e) => setAttempts(e.target.value)}
                />
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  هر بار که بازبینی ایراد بگیرد، یک دور اصلاح انجام می‌شود. با
                  مدل‌های ضعیف‌تر عدد بالاتر یعنی کندتر ولی دقیق‌تر.
                </p>
              </div>
            </div>

            {current?.editable_base_url && (
              <div className="space-y-1.5">
                <Label htmlFor="base-url">نشانی سرویس</Label>
                <Input
                  id="base-url"
                  dir="ltr"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={current?.base_url || "http://127.0.0.1:11434/v1"}
                  className="font-mono text-[11.5px]"
                />
              </div>
            )}

            {probe && (
              <div
                className={cn(
                  "flex items-start gap-2 rounded-md border px-3 py-2 text-[11.5px]",
                  probe.ok
                    ? "border-ok/40 bg-ok/10 text-ok"
                    : "border-err/40 bg-err/10 text-err",
                )}
              >
                {probe.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <span className="min-w-0">
                  {probe.ok
                    ? `ارتباط برقرار شد — مدل ${probe.model} پاسخ داد.`
                    : probe.error}
                </span>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-1.5">
          <Button
            type="button"
            variant="outline"
            onClick={test}
            disabled={!conf?.providers || busy !== ""}
          >
            {busy === "test" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <KeyRound className="h-3.5 w-3.5" />
            )}
            آزمایش اتصال
          </Button>
          <Button type="button" onClick={save} disabled={!conf?.providers || busy !== ""}>
            {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            ذخیره
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
