"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Eye, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api/client";
import { TEMPLATE_VARIABLES } from "@/lib/outreach/template";

const CHANNELS = [
  ["EMAIL", "Email"], ["WHATSAPP", "WhatsApp"], ["LINKEDIN", "LinkedIn"], ["PHONE", "Call"], ["SMS", "SMS"], ["IN_PERSON", "In person"],
] as const;
const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;

type Step = { dayOffset: string; channel: string; isManualTask: boolean; subject: string; bodyTemplate: string };
export type SequenceDraft = {
  id?: string; name: string; description: string; stopOnReply: boolean; stopOnUnsubscribe: boolean;
  sendWindowStart: number; sendWindowEnd: number; sendDays: number[]; timezone: string; dailyCap: number;
  steps: { dayOffset: number; channel: string; isManualTask: boolean; subject: string | null; bodyTemplate: string }[];
};
type Preview = { lead: { name: string } | null; toAddress: string | null; recipientBlock: string | null; subject: string; body: string; unresolved: string[]; unknown: string[]; copyWarnings: string[] };

/** The day 0 / 3 / 10 email preset, written with variables every lead can fill. */
const PRESET: Step[] = [
  { dayOffset: "0", channel: "EMAIL", isManualTask: false, subject: "{{company}} and {{signal}}", bodyTemplate: "Hi {{first_name}},\n\nI noticed {{company}} {{signal}}. We help teams like yours get there without a long project.\n\nWorth a 20-minute call next week?\n\n{{sender_first_name}}" },
  { dayOffset: "3", channel: "EMAIL", isManualTask: false, subject: "Re: {{company}} and {{signal}}", bodyTemplate: "Hi {{first_name}},\n\nFollowing up in case this got buried. Happy to share how a similar {{industry}} team approached it.\n\n{{sender_first_name}}" },
  { dayOffset: "10", channel: "EMAIL", isManualTask: false, subject: "Closing the loop", bodyTemplate: "Hi {{first_name}},\n\nI won't keep following up. If timing changes, reply here and I'll pick it up.\n\n{{sender_first_name}}" },
];

function problems(steps: Step[], start: number, end: number, days: number[]): string[] {
  const out: string[] = [];
  if (end <= start) out.push("The send window must end after it starts.");
  if (days.length === 0) out.push("Pick at least one sending day.");
  steps.forEach((s, i) => {
    const d = Number(s.dayOffset);
    if (!Number.isInteger(d) || d < 0) out.push(`Step ${i + 1}: the day must be a whole number, 0 or more.`);
    if (i > 0 && d < Number(steps[i - 1].dayOffset)) out.push(`Step ${i + 1} is on day ${d}, before step ${i} — steps must not go backwards.`);
    if (!s.bodyTemplate.trim()) out.push(`Step ${i + 1} needs a body.`);
    if (s.channel === "EMAIL" && !s.isManualTask && !s.subject.trim()) out.push(`Step ${i + 1} is an email and needs a subject.`);
  });
  return out;
}

export function SequenceEditor({ initial }: { initial: SequenceDraft }) {
  const router = useRouter();
  const [name, setName] = React.useState(initial.name);
  const [description, setDescription] = React.useState(initial.description);
  const [stopOnReply, setStopOnReply] = React.useState(initial.stopOnReply);
  const [stopOnUnsubscribe, setStopOnUnsubscribe] = React.useState(initial.stopOnUnsubscribe);
  const [start, setStart] = React.useState(initial.sendWindowStart);
  const [end, setEnd] = React.useState(initial.sendWindowEnd);
  const [days, setDays] = React.useState<number[]>(initial.sendDays);
  const [timezone, setTimezone] = React.useState(initial.timezone);
  const [dailyCap, setDailyCap] = React.useState(String(initial.dailyCap));
  const [steps, setSteps] = React.useState<Step[]>(initial.steps.length ? initial.steps.map((s) => ({ dayOffset: String(s.dayOffset), channel: s.channel, isManualTask: s.isManualTask, subject: s.subject ?? "", bodyTemplate: s.bodyTemplate })) : PRESET);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [previewLead, setPreviewLead] = React.useState<{ id: string; name: string } | null>(null);
  const [leadQuery, setLeadQuery] = React.useState("");
  const [leadHits, setLeadHits] = React.useState<{ id: string; name: string; company: string }[]>([]);
  const [previews, setPreviews] = React.useState<Record<number, Preview | string>>({});

  const issues = problems(steps, start, end, days);
  const cap = Number(dailyCap);
  const capValid = Number.isInteger(cap) && cap >= 1 && cap <= 2000;

  React.useEffect(() => {
    if (previewLead || leadQuery.trim().length < 2) { setLeadHits([]); return; }
    const t = setTimeout(() => { api.get<{ leads: { id: string; name: string; company: string }[] }>(`/api/leads?q=${encodeURIComponent(leadQuery.trim())}`).then((r) => setLeadHits(r.leads), () => setLeadHits([])); }, 250);
    return () => clearTimeout(t);
  }, [leadQuery, previewLead]);

  const setStep = (i: number, patch: Partial<Step>) => setSteps((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function preview(i: number) {
    const s = steps[i];
    try {
      const r = await api.post<Preview>("/api/sequences/preview", { leadId: previewLead?.id, subject: s.subject || undefined, bodyTemplate: s.bodyTemplate });
      setPreviews((p) => ({ ...p, [i]: r }));
    } catch (err) { setPreviews((p) => ({ ...p, [i]: err instanceof ApiError ? err.message : "Preview failed." })); }
  }

  async function save() {
    setPending(true); setError("");
    const body = {
      name: name.trim(), description: description.trim() || undefined, stopOnReply, stopOnUnsubscribe,
      sendWindowStart: start, sendWindowEnd: end, sendDays: days, timezone: timezone.trim() || "Asia/Kolkata", dailyCap: cap,
      steps: steps.map((s, i) => ({ stepOrder: i + 1, dayOffset: Number(s.dayOffset), channel: s.channel, isManualTask: s.isManualTask, subject: s.subject.trim() || undefined, bodyTemplate: s.bodyTemplate })),
    };
    try {
      if (initial.id) await api.put(`/api/sequences/${initial.id}`, body);
      else await api.post("/api/sequences", body);
      toast.success(initial.id ? "Sequence saved" : "Sequence created", { description: initial.id ? undefined : "It starts paused. Enrol leads, check the previews, then activate it." });
      router.push("/outreach"); router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Not saved. Nothing was changed.");
    } finally { setPending(false); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-3 py-4 sm:px-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="xs" asChild><Link href="/outreach"><ArrowLeft />Outreach</Link></Button>
        <h1 className="text-lg font-semibold text-primary">{initial.id ? "Edit sequence" : "New sequence"}</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Rules</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="sq-name" required><Input id="sq-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <Field label="Daily cap" htmlFor="sq-cap" hint="Most sends per day across the whole sequence." error={capValid ? undefined : "Between 1 and 2000."}><Input id="sq-cap" inputMode="numeric" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} className="tabular" /></Field>
          <Field label="Description" htmlFor="sq-desc" className="sm:col-span-2"><Input id="sq-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Send from (hour)" htmlFor="sq-start"><Input id="sq-start" type="number" min={0} max={23} value={start} onChange={(e) => setStart(Number(e.target.value))} className="tabular" /></Field>
            <Field label="Until (hour)" htmlFor="sq-end"><Input id="sq-end" type="number" min={1} max={24} value={end} onChange={(e) => setEnd(Number(e.target.value))} className="tabular" /></Field>
          </div>
          <Field label="Timezone" htmlFor="sq-tz" hint="The recipient-facing clock for the window."><Input id="sq-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} /></Field>
          <div className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-primary">Sending days</span>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map(([d, label]) => (
                <label key={d} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-2xs text-secondary">
                  <input type="checkbox" checked={days.includes(d)} onChange={(e) => setDays((xs) => (e.target.checked ? [...xs, d].sort() : xs.filter((x) => x !== d)))} />{label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-secondary"><input type="checkbox" checked={stopOnReply} onChange={(e) => setStopOnReply(e.target.checked)} />Stop when they reply</label>
          <label className="flex items-center gap-2 text-xs text-secondary"><input type="checkbox" checked={stopOnUnsubscribe} onChange={(e) => setStopOnUnsubscribe(e.target.checked)} />Stop when they unsubscribe</label>
          {stopOnReply ? <p className="text-2xs text-muted sm:col-span-2">Stopping on reply needs a mailbox connected for reading replies (Settings → Email Accounts → Reply reading). Without one, this sequence can be built and previewed but not activated or enrolled into. A reply you log on a lead also stops it.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Steps</CardTitle>
          <div className="relative w-64 max-w-full">
            {previewLead ? (
              <p className="text-2xs text-secondary">Previewing as <strong className="text-primary">{previewLead.name}</strong> <button type="button" className="underline" onClick={() => { setPreviewLead(null); setPreviews({}); }}>change</button></p>
            ) : (
              <>
                <Input aria-label="Preview as lead" placeholder="Preview as a lead…" value={leadQuery} onChange={(e) => setLeadQuery(e.target.value)} />
                {leadHits.length ? (
                  <ul className="absolute right-0 z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-raised">
                    {leadHits.map((l) => <li key={l.id}><button type="button" className="w-full px-2 py-1.5 text-left text-xs hover:bg-surface-hover" onClick={() => { setPreviewLead(l); setLeadQuery(""); setPreviews({}); }}>{l.name} <span className="text-muted">· {l.company}</span></button></li>)}
                  </ul>
                ) : null}
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-2xs text-muted">Variables: {TEMPLATE_VARIABLES.map((v) => <code key={v.key} className="mr-1 rounded bg-surface-sunken px-1">{`{{${v.key}}}`}</code>)}</p>
          {steps.map((s, i) => {
            const pv = previews[i];
            return (
              <div key={i} className="space-y-2 rounded-md border border-border-subtle p-2.5">
                <div className="flex flex-wrap items-end gap-2">
                  <span className="text-xs font-semibold text-primary">Step {i + 1}</span>
                  <Field label="Day" htmlFor={`sq-day-${i}`}><Input id={`sq-day-${i}`} inputMode="numeric" value={s.dayOffset} onChange={(e) => setStep(i, { dayOffset: e.target.value })} className="w-16 tabular" /></Field>
                  <Field label="Channel" htmlFor={`sq-ch-${i}`}>
                    <select id={`sq-ch-${i}`} value={s.channel} onChange={(e) => setStep(i, { channel: e.target.value, isManualTask: e.target.value !== "EMAIL" ? true : s.isManualTask })} className="h-8 rounded-md border border-border bg-surface px-2 text-xs">
                      {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Field>
                  <label className="flex items-center gap-1.5 pb-2 text-2xs text-secondary">
                    <input type="checkbox" checked={s.isManualTask} disabled={s.channel !== "EMAIL"} onChange={(e) => setStep(i, { isManualTask: e.target.checked })} />
                    Manual task {s.channel !== "EMAIL" ? "(only email is sent automatically)" : ""}
                  </label>
                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => void preview(i)}><Eye />Preview</Button>
                    <Button variant="ghost" size="sm" aria-label={`Remove step ${i + 1}`} disabled={steps.length === 1} onClick={() => setSteps((xs) => xs.filter((_, j) => j !== i))}><Trash2 /></Button>
                  </span>
                </div>
                {s.channel === "EMAIL" ? <Input aria-label={`Step ${i + 1} subject`} value={s.subject} onChange={(e) => setStep(i, { subject: e.target.value })} placeholder="Subject" maxLength={300} /> : null}
                <Textarea aria-label={`Step ${i + 1} body`} rows={5} value={s.bodyTemplate} onChange={(e) => setStep(i, { bodyTemplate: e.target.value })} maxLength={20000} />
                {typeof pv === "string" ? <p className="text-2xs text-danger-text">{pv}</p> : pv ? (
                  <div className="space-y-1 rounded bg-surface-sunken p-2 text-2xs">
                    <p className="text-muted">Dry run{pv.lead ? ` for ${pv.lead.name}` : " with example values"} — nothing is sent. {pv.lead ? (pv.toAddress ? `Would go to ${pv.toAddress}.` : `No usable address${pv.recipientBlock ? `: ${pv.recipientBlock}` : "."}`) : ""}</p>
                    {s.channel === "EMAIL" ? <p className="font-medium text-primary">{pv.subject}</p> : null}
                    <p className="whitespace-pre-wrap text-secondary">{pv.body}</p>
                    {pv.unknown.length ? <p className="text-danger-text">Unknown variables: {pv.unknown.join(", ")} — no lead can fill these.</p> : null}
                    {pv.unresolved.length ? <p className="text-warning-text">Empty for this lead: {pv.unresolved.join(", ")}.</p> : null}
                    {pv.copyWarnings.map((w) => <p key={w} className="text-warning-text">{w}</p>)}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => setSteps((xs) => [...xs, { dayOffset: String(Number(xs[xs.length - 1]?.dayOffset ?? 0) + 3), channel: "EMAIL", isManualTask: false, subject: "", bodyTemplate: "" }])}><Plus />Add step</Button>
            {!initial.id ? <Button variant="ghost" size="sm" onClick={() => setSteps(PRESET)}>Use day 0 / 3 / 10 email preset</Button> : null}
          </div>
        </CardContent>
      </Card>

      {issues.length ? <ul className="space-y-0.5 text-2xs text-warning-text">{issues.map((p) => <li key={p}>{p}</li>)}</ul> : null}
      {error ? <p role="alert" className="text-xs text-danger-text">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <p className="mr-auto text-2xs text-muted">{initial.id ? "Saving does not change whether it is active." : "New sequences start paused. Saving sends nothing."}</p>
        <Button variant="ghost" size="sm" asChild><Link href="/outreach">Cancel</Link></Button>
        <Button variant="primary" size="sm" loading={pending} disabled={issues.length > 0 || !capValid || name.trim().length < 2} onClick={() => void save()}>{initial.id ? "Save" : "Create sequence"}</Button>
      </div>
    </div>
  );
}
