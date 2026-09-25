"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatAge } from "@/lib/format";
import type { listMailboxes } from "@/lib/services/mailboxes";

type Mailbox = Awaited<ReturnType<typeof listMailboxes>>[number];
const STATUS: Record<string, { label: string; variant: "success" | "danger" | "neutral" | "warning" }> = { CONNECTED: { label: "Reading replies", variant: "success" }, ERROR: { label: "Error", variant: "danger" }, REVOKED: { label: "Disconnected", variant: "neutral" }, UNTESTED: { label: "Not checked", variant: "warning" } };
const PRESETS: Record<string, { imapHost: string; note: string }> = {
  "gmail.com": { imapHost: "imap.gmail.com", note: "Google Workspace and Gmail: turn on IMAP, and use an app password if two-step sign-in is on." },
  "outlook.com": { imapHost: "outlook.office365.com", note: "Microsoft 365: IMAP must be allowed for the mailbox; basic-auth IMAP may be disabled by your admin." },
  "zoho.com": { imapHost: "imap.zoho.in", note: "Zoho Mail (India data centre). Use imap.zoho.com for other regions." },
};

/** Connect, test, read now and disconnect the mailboxes whose replies this workspace reads. */
export function MailboxesPanel({ initial, canManage }: { initial: Mailbox[]; canManage: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ label: "", address: "", imapHost: "", imapPort: 993, imapUser: "", password: "", folder: "INBOX" });
  const [open, setOpen] = useState(initial.length === 0); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const set = (k: keyof typeof form, v: string | number) => setForm(f => ({ ...f, [k]: v }));
  const preset = Object.entries(PRESETS).find(([d]) => form.address.endsWith(`@${d}`) || form.imapHost === PRESETS[d].imapHost)?.[1];
  async function act(fn: () => Promise<{ note?: string }>) { setBusy(true); setMessage(""); try { const r = await fn(); if (r.note) setMessage(r.note); router.refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); } }
  return <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
    <div><h2 className="text-sm font-semibold text-primary">Reply reading (IMAP)</h2>
      <p className="mt-0.5 text-xs text-secondary">Connect the mailbox your outreach replies arrive in. It is read every five minutes, read-only: nothing is marked read, moved or deleted. A reply to something sent from here is added to its conversation and stops any sequence set to stop on reply. Out-of-office answers and bounces are recorded but do not stop anything. Sending still uses the server&apos;s configured SMTP relay.</p></div>
    {message && <p role="status" className="rounded border border-border p-2 text-xs">{message}</p>}
    {initial.length > 0 && <ul className="divide-y divide-border">{initial.map(m => <li key={m.id} className="flex min-w-0 flex-wrap items-center gap-2 py-2 text-xs">
      <span className="min-w-0 flex-1 break-words"><span className="font-medium text-primary">{m.label}</span> · {m.address} <span className="text-secondary">· {m.imapHost}:{m.imapPort}{m.lastSyncedAt ? ` · read ${formatAge(m.lastSyncedAt)}` : ""} · {m.repliesMatched} {m.repliesMatched === 1 ? "reply" : "replies"} recorded</span>{m.lastError && <span className="block text-danger-text">{m.lastError}</span>}</span>
      <Badge variant={STATUS[m.status]?.variant ?? "neutral"} size="sm">{STATUS[m.status]?.label ?? m.status}</Badge>
      {canManage && !m.revokedAt && <><Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api.post(`/api/mailboxes/${m.id}/sync`, {}))}>Read now</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api.post(`/api/mailboxes/${m.id}/test`, {}))}>Test</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`Disconnect ${m.address}? Its password is erased and replies stop being read. Replies already recorded stay.`)) void act(() => api.del(`/api/mailboxes/${m.id}`)); }}>Disconnect</Button></>}
    </li>)}</ul>}
    {canManage && !open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Connect a mailbox</Button>}
    {!canManage && <p className="text-xs text-secondary">Only workspace managers can connect mailboxes.</p>}
    {canManage && open && <form onSubmit={e => { e.preventDefault(); void act(async () => { const r = await api.post<{ note: string }>("/api/mailboxes", { ...form, imapPort: Number(form.imapPort), imapSecure: true }); setForm(f => ({ ...f, password: "" })); setOpen(false); return r; }); }} className="grid gap-3 md:grid-cols-2">
      <label className="block text-xs">Name<Input required minLength={2} value={form.label} onChange={e => set("label", e.target.value)} placeholder="Sales inbox" className="mt-1" /></label>
      <label className="block text-xs">Email address<Input required type="email" value={form.address} onChange={e => { set("address", e.target.value); if (!form.imapUser) set("imapUser", e.target.value); }} className="mt-1" /></label>
      <label className="block text-xs">IMAP server<Input required value={form.imapHost} onChange={e => set("imapHost", e.target.value.trim())} placeholder={preset?.imapHost ?? "imap.example.com"} className="mt-1" /></label>
      <label className="block text-xs">Port (TLS)<Input required type="number" min={1} max={65535} value={form.imapPort} onChange={e => set("imapPort", Number(e.target.value))} className="mt-1 max-w-28 tabular-nums" /></label>
      <label className="block text-xs">User name<Input required value={form.imapUser} onChange={e => set("imapUser", e.target.value)} className="mt-1" /></label>
      <label className="block text-xs">Password or app password<Input required type="password" autoComplete="new-password" value={form.password} onChange={e => set("password", e.target.value)} className="mt-1" /><span className="text-2xs text-muted">Encrypted on the server and never shown again.</span></label>
      <label className="block text-xs">Folder<Input value={form.folder} onChange={e => set("folder", e.target.value)} className="mt-1" /></label>
      {preset && <p className="self-end text-2xs text-secondary">{preset.note}</p>}
      <div className="flex gap-2 md:col-span-2"><Button type="submit" size="sm" disabled={busy}>Connect and check</Button><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
      <p className="text-2xs text-muted md:col-span-2">Only TLS connections are made (port 993 on most servers). Google and Microsoft sign-in through OAuth needs an app registered with them first; until then use IMAP with an app password.</p>
    </form>}
  </section>;
}
