import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, ListChecks, Loader2, MessageSquareWarning, Search } from "lucide-react";

import { cn, fa } from "@/lib/utils";
import { CHECKLIST, DOCS, ERRORS, loadDoc, searchDocs, sections, slug, translateError } from "@/lib/report/docs";
import { Section } from "@/components/primitives";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Markdown from "./Markdown";
import { useStoredState } from "./shared";

/*
  مرجع — همهٔ دانش مهارت گزارش‌سازی راهکاران داخل برنامه، با جست‌وجو،
  مترجم خطاهای Report Builder و چک‌لیست تحویل. آفلاین کار می‌کند.
*/

function ErrorTranslator() {
  const [text, setText] = useState("");
  const hits = useMemo(() => translateError(text), [text]);
  return (
    <Section icon={MessageSquareWarning} title="مترجم خطای Report Builder" hint="متن خطا را بچسبانید؛ معنی واقعی و راه‌حل را می‌گوید.">
      <div className="space-y-2">
        <Textarea dir="ltr" value={text} onChange={(e) => setText(e.target.value)} className="min-h-[70px] font-mono text-[11.5px]" placeholder="The tablix 'Tablix1' has a detail member with inner members…" />
        {text.trim() && !hits.length && (
          <p className="text-[11.5px] text-muted-foreground">این خطا در فهرست شناخته‌شده‌ها نیست. فایل را در زبانهٔ «تحلیل و اصلاح RDL» بارگذاری کنید تا اعتبارسنج دقیق بگوید کجاست.</p>
        )}
        {hits.map((h) => (
          <div key={h.title} className="space-y-1 rounded-md border border-warn/40 bg-warn/8 px-3 py-2 text-[11.5px] leading-relaxed">
            <p className="font-semibold text-foreground">{h.title}</p>
            <p className="text-muted-foreground"><span className="font-semibold text-foreground/80">علت: </span>{h.cause}</p>
            <p className="text-muted-foreground"><span className="font-semibold text-foreground/80">راه‌حل: </span>{h.fix}</p>
          </div>
        ))}
        {!text.trim() && (
          <details className="rounded-md border border-border bg-ink/30">
            <summary className="cursor-pointer px-3 py-2 text-[11.5px] text-muted-foreground">همهٔ خطاهای شناخته‌شده ({fa(ERRORS.length)})</summary>
            <ul className="space-y-1.5 p-2">
              {ERRORS.map((e) => (
                <li key={e.title} className="rounded border border-border/70 px-2.5 py-1.5 text-[11px] leading-relaxed">
                  <span className="font-semibold text-foreground">{e.title}: </span>
                  <span className="text-muted-foreground">{e.fix}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Section>
  );
}

function DeliveryChecklist() {
  const [done, setDone] = useStoredState("kavosh.rb.docs-checklist.v1", {});
  const count = CHECKLIST.filter((c) => done[c.id]).length;
  return (
    <Section icon={ListChecks} title="چک‌لیست تحویل گزارش" hint={`${fa(count)} از ${fa(CHECKLIST.length)}`} actions={count > 0 && (
      <button type="button" className="text-[11px] text-brand-text underline-offset-2 hover:underline" onClick={() => setDone({})}>از نو</button>
    )}>
      <ul className="space-y-1">
        {CHECKLIST.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-start gap-2 text-[11.5px] leading-relaxed">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" checked={Boolean(done[c.id])} onChange={(e) => setDone({ ...done, [c.id]: e.target.checked })} />
              <span className={done[c.id] ? "text-muted-foreground line-through" : "text-foreground/90"}>{c.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export default function DocsTab() {
  const [docId, setDocId] = useStoredState("kavosh.rb.doc.v1", "db-conventions");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState(null);
  const [searching, setSearching] = useState(false);
  const [jump, setJump] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    loadDoc(docId).then((t) => alive && setText(t)).catch((e) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [docId]);

  useEffect(() => {
    if (!jump || loading) return;
    const el = document.getElementById(jump);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setJump("");
  }, [jump, loading, text]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits(null);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchDocs(q);
        if (alive) setHits(r);
      } finally {
        if (alive) setSearching(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const toc = useMemo(() => sections(text).filter((s) => s.level >= 2 && s.level <= 3), [text]);
  const doc = DOCS.find((d) => d.id === docId) || DOCS[0];
  const groups = [...new Set(DOCS.map((d) => d.group))];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[17rem_1fr]">
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو در همهٔ مرجع‌ها…" className="ps-8" />
            {searching && <Loader2 className="absolute end-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          {hits ? (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">{fa(hits.length)} نتیجه</p>
              {hits.map((h, i) => (
                <button key={i} type="button" onClick={() => { setDocId(h.doc); setJump(h.anchor); setQ(""); }} className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-start transition-colors hover:border-brand/40">
                  <div className="text-[11.5px] font-semibold text-foreground">{h.section || h.docTitle}</div>
                  <div className="text-[10.5px] text-brand-text">{h.docTitle}</div>
                  <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-muted-foreground">{h.snippet}</div>
                </button>
              ))}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g} className="space-y-1">
                <p className="px-1 text-[10.5px] font-bold text-muted-foreground">{g}</p>
                {DOCS.filter((d) => d.group === g).map((d) => (
                  <button key={d.id} type="button" onClick={() => setDocId(d.id)} className={cn("w-full rounded-md border px-2.5 py-2 text-start transition-colors", d.id === docId ? "border-brand/45 bg-brand/10" : "border-border bg-surface hover:border-brand/30")}>
                    <div className="text-[12px] font-semibold text-foreground">{d.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-muted-foreground">{d.summary}</div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <Section icon={BookOpen} title={doc.title} hint={doc.summary} className="min-w-0">
          {toc.length > 3 && (
            <details className="mb-3 rounded-md border border-border bg-ink/30">
              <summary className="cursor-pointer px-3 py-1.5 text-[11.5px] text-muted-foreground">فهرست مطالب ({fa(toc.length)})</summary>
              <ul className="space-y-0.5 p-2">
                {toc.map((s, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => setJump(slug(s.title))} className={cn("flex items-center gap-1 text-start text-[11.5px] text-brand-text hover:underline", s.level === 3 && "ps-4 text-[11px]")}>
                      <ChevronRight className="h-3 w-3 shrink-0 rtl:rotate-180" />{s.title.replace(/[`*]/g, "")}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /> : error ? <p className="text-[12px] text-err">{error}</p> : <Markdown text={text} />}
        </Section>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ErrorTranslator />
        <DeliveryChecklist />
      </div>
    </div>
  );
}
