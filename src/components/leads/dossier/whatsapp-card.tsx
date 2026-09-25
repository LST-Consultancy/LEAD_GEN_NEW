"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { whatsappForLead } from "@/lib/services/whatsapp";

type Info = Awaited<ReturnType<typeof whatsappForLead>>;
const field = "mt-1 block w-full rounded border border-border bg-surface p-1.5 text-xs";

/** WhatsApp for one lead: record their opt-in, then send within Meta's rules. Every refusal says why. */
export function WhatsAppCard({ leadId, info }: { leadId: string; info: Info }) {
  const router = useRouter();
  const [number, setNumber] = useState(info.suggestedNumber ?? ""); const [evidence, setEvidence] = useState("");
  const [kind, setKind] = useState<"text" | "template">(info.allowed === "template_only" ? "template" : "text");
  const [body, setBody] = useState(""); const [template, setTemplate] = useState(""); const [language, setLanguage] = useState("en"); const [params, setParams] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function post(payload: unknown, done: string) {
    setBusy(true); setMessage("");
    try { const r = await api.post<{ note?: string }>(`/api/leads/${leadId}/whatsapp`, payload); setMessage(r.note ?? done); router.refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); }
  }
  if (!info.connected) return <Card><CardHeader><CardTitle>WhatsApp</CardTitle></CardHeader><CardContent className="pt-0 text-2xs text-secondary">Not connected. <Link href="/settings/whatsapp-api" className="underline">Connect your WhatsApp Business number</Link> to message leads who opted in.</CardContent></Card>;
  const blocked = info.optedOut || info.suppressed;
  const hasOptIn = Boolean(info.number && (info.consent || info.lastInboundAt));
  return <Card><CardHeader><CardTitle>WhatsApp</CardTitle></CardHeader><CardContent className="space-y-2 pt-0 text-xs">
    {info.number && <p className="text-secondary">{info.number}{info.consent ? ` · opted in ${info.consent.at.slice(0, 10)} (${info.consent.evidence})` : info.lastInboundAt ? " · messaged you first" : ""}</p>}
    {blocked && <p className="text-danger-text">They opted out or the number is on the do-not-contact list. Nothing can be sent.</p>}
    {!blocked && !hasOptIn && info.canRecord && <form onSubmit={e => { e.preventDefault(); void post({ optIn: { number, evidence } }, "Opt-in recorded."); }} className="space-y-1.5">
      <p className="text-secondary">Meta forbids cold messages. Record how this person opted in before sending anything.</p>
      <label className="block">WhatsApp number (with country code)<input required value={number} onChange={e => setNumber(e.target.value)} className={field} /></label>
      <label className="block">How and when they opted in<input required minLength={8} value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="Ticked the WhatsApp box on the demo form, 12 Sep" className={field} /></label>
      <Button type="submit" size="sm" variant="outline" disabled={busy}>Record opt-in</Button>
    </form>}
    {!blocked && hasOptIn && info.canSend && <form onSubmit={e => { e.preventDefault(); void post({ idempotencyKey: crypto.randomUUID(), message: kind === "text" ? { kind, body } : { kind, name: template, language, params: params.split("\n").map(s => s.trim()).filter(Boolean) } }, "Sent."); }} className="space-y-1.5">
      <p className="text-secondary">{info.allowed === "text_or_template" ? "They messaged within the last 24 hours, so free text is allowed." : "Outside 24 hours of their last message, so only an approved template can be sent."}</p>
      <div className="flex gap-3">{(["text", "template"] as const).map(k => <label key={k} className="flex items-center gap-1"><input type="radio" checked={kind === k} disabled={k === "text" && info.allowed === "template_only"} onChange={() => setKind(k)} />{k === "text" ? "Message" : "Template"}</label>)}</div>
      {kind === "text" ? <textarea required maxLength={4096} rows={3} value={body} onChange={e => setBody(e.target.value)} className={field} /> : <>
        <label className="block">Approved template name<input required pattern="[a-z0-9_]+" value={template} onChange={e => setTemplate(e.target.value)} className={field} /></label>
        <label className="block">Language code<input required value={language} onChange={e => setLanguage(e.target.value)} className={`${field} max-w-24`} /></label>
        <label className="block">Variables, one per line, in order<textarea rows={2} value={params} onChange={e => setParams(e.target.value)} className={field} /></label>
      </>}
      <Button type="submit" size="sm" disabled={busy}>Send on WhatsApp</Button>
    </form>}
    {message && <p role="status" className="text-2xs">{message}</p>}
  </CardContent></Card>;
}
