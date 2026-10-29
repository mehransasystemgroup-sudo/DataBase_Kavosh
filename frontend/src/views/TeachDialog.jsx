import { useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";

import { errorMessage, http } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[10px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * ثبت دانش کاربر روی جدول.
 *
 * آنچه کاربر می‌گوید در KB با اطمینان بالا ذخیره می‌شود و هم‌زمان روی ایندکس
 * زنده می‌نشیند، پس بی‌درنگ در جست‌وجو دیده می‌شود.
 */
export default function TeachDialog({ table, onDone }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [meta, setMeta] = useState({ title_fa: "", description_fa: "", gotcha: "" });
  const [enumForm, setEnumForm] = useState({ column: "", value: "", label_fa: "" });
  const [joinForm, setJoinForm] = useState({ from_col: "", to_table: "", to_col: "" });

  const send = async (kind, payload, successText) => {
    setBusy(true);
    try {
      const { data } = await http.post("/knowledge", { kind, payload });
      toast.success(data.message || successText, {
        description: data.applied
          ? "هم‌اکنون در جست‌وجو فعال است."
          : data.note || undefined,
      });
      setOpen(false);
      onDone?.();
    } catch (e) {
      toast.error(errorMessage(e, "ثبت دانش ناموفق بود."));
    } finally {
      setBusy(false);
    }
  };

  const saveMeta = () => {
    if (!meta.title_fa.trim() && !meta.description_fa.trim() && !meta.gotcha.trim()) {
      toast.error("دست‌کم یکی از فیلدها را پر کنید.");
      return;
    }
    send(
      "table",
      {
        full_name: table.full_name,
        title_fa: meta.title_fa.trim() || undefined,
        description_fa: meta.description_fa.trim() || undefined,
        gotcha: meta.gotcha.trim() || undefined,
      },
      "معنی جدول ثبت شد.",
    );
  };

  const saveEnum = () => {
    if (!enumForm.column.trim() || enumForm.value === "" || !enumForm.label_fa.trim()) {
      toast.error("ستون، مقدار و معنی فارسی هر سه لازم است.");
      return;
    }
    send(
      "enum",
      {
        full_name: table.full_name,
        column: enumForm.column.trim(),
        value: String(enumForm.value).trim(),
        label_fa: enumForm.label_fa.trim(),
      },
      "معنی مقدار ثبت شد.",
    );
  };

  const saveJoin = () => {
    if (!joinForm.from_col.trim() || !joinForm.to_table.trim() || !joinForm.to_col.trim()) {
      toast.error("ستون مبدأ، جدول مقصد و ستون مقصد لازم است.");
      return;
    }
    send(
      "join",
      {
        from_table: table.full_name,
        from_col: joinForm.from_col.trim(),
        to_table: joinForm.to_table.trim(),
        to_col: joinForm.to_col.trim(),
      },
      "مسیر JOIN تأیید و ثبت شد.",
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="soft" size="sm" aria-label="آموزش دانش" title="آموزش دانش">
          <GraduationCap />
          <span className="hidden sm:inline">آموزش دانش</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>آموزش دانش دربارهٔ {table.full_name}</DialogTitle>
          <DialogDescription>
            آنچه شما ثبت کنید با اطمینان بالا در پایگاه دانش می‌نشیند و بر استنتاج‌های
            خودکار اولویت دارد.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="meta">
          <TabsList className="w-full">
            <TabsTrigger value="meta" className="flex-1">
              معنی جدول
            </TabsTrigger>
            <TabsTrigger value="enum" className="flex-1">
              مقدار کددار
            </TabsTrigger>
            <TabsTrigger value="join" className="flex-1">
              مسیر JOIN
            </TabsTrigger>
          </TabsList>

          <TabsContent value="meta" className="space-y-3">
            <Field label="عنوان فارسی">
              <Input
                value={meta.title_fa}
                onChange={(e) => setMeta((m) => ({ ...m, title_fa: e.target.value }))}
                placeholder={table.title_fa || "مثلاً: سند حسابداری"}
              />
            </Field>
            <Field label="توضیح" hint="این جدول چه چیزی را نگه می‌دارد و کِی پر می‌شود؟">
              <Textarea
                value={meta.description_fa}
                onChange={(e) => setMeta((m) => ({ ...m, description_fa: e.target.value }))}
                rows={3}
                placeholder={table.description_fa || "توضیح کوتاه دربارهٔ نقش این جدول…"}
              />
            </Field>
            <Field label="نکتهٔ مهم (Gotcha)" hint="تله‌ای که هر بار کسی را می‌اندازد.">
              <Textarea
                value={meta.gotcha}
                onChange={(e) => setMeta((m) => ({ ...m, gotcha: e.target.value }))}
                rows={2}
                placeholder="مثلاً: بدون فیلتر سال مالی، جمع‌ها دو برابر می‌شود."
              />
            </Field>
            <DialogFooter>
              <Button onClick={saveMeta} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                ثبت معنی جدول
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="enum" className="space-y-3">
            <Field label="ستون">
              <select
                value={enumForm.column}
                onChange={(e) => setEnumForm((f) => ({ ...f, column: e.target.value }))}
                className="ltr h-9 w-full rounded-md border border-border bg-ink px-3 font-mono text-xs text-foreground focus-visible:border-brand/60 focus-visible:outline-none"
              >
                <option value="">— انتخاب ستون —</option>
                {(table.columns || []).map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.type})
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="مقدار ذخیره‌شده">
                <Input
                  value={enumForm.value}
                  onChange={(e) => setEnumForm((f) => ({ ...f, value: e.target.value }))}
                  placeholder="1"
                  className="ltr font-mono"
                />
              </Field>
              <Field label="معنی فارسی">
                <Input
                  value={enumForm.label_fa}
                  onChange={(e) => setEnumForm((f) => ({ ...f, label_fa: e.target.value }))}
                  placeholder="تأییدشده"
                />
              </Field>
            </div>
            <DialogFooter>
              <Button onClick={saveEnum} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                ثبت مقدار
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="join" className="space-y-3">
            <Field label="ستون مبدأ در همین جدول">
              <select
                value={joinForm.from_col}
                onChange={(e) => setJoinForm((f) => ({ ...f, from_col: e.target.value }))}
                className="ltr h-9 w-full rounded-md border border-border bg-ink px-3 font-mono text-xs text-foreground focus-visible:border-brand/60 focus-visible:outline-none"
              >
                <option value="">— انتخاب ستون —</option>
                {(table.columns || []).map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="جدول مقصد">
                <Input
                  value={joinForm.to_table}
                  onChange={(e) => setJoinForm((f) => ({ ...f, to_table: e.target.value }))}
                  placeholder="GNR3.Party"
                  className="ltr font-mono"
                />
              </Field>
              <Field label="ستون مقصد">
                <Input
                  value={joinForm.to_col}
                  onChange={(e) => setJoinForm((f) => ({ ...f, to_col: e.target.value }))}
                  placeholder="PartyID"
                  className="ltr font-mono"
                />
              </Field>
            </div>
            <DialogFooter>
              <Button onClick={saveJoin} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                تأیید و ثبت مسیر
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
