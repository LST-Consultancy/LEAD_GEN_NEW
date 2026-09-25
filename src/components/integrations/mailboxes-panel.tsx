"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatAge } from "@/lib/format";
import { CAPABILITY_LABEL, MAILBOX_PROVIDERS, type Capability, type MailboxProvider } from "@/lib/outreach/mailbox-capability";
import type { listMailboxes } from "@/lib/services/mailboxes";

type Mailbox = Awaited<ReturnType<typeof listMailboxes>>[number];
const CAPABILITY_VARIANT: Record<Capability, "success" | "info" | "warning" | "danger"> = { full: "success", send_only: "info", receive_only: "info", none: "danger" };
const PRESETS: Record<string, { imapHost: string; smtpHost: string; note: string }> = {
  "gmail.com": { imapHost: "imap.gmail.com", smtpHost: "smtp.gmail.com", note: "Google Workspace and Gmail: turn on IMAP, and use an app password if two-step sign-in is on — or connect with Google sign-in instead." },
  "outlook.com": { imapHost: "outlook.office365.com", smtpHost: "smtp.office365.com", note: "Microsoft 365: IMAP and authenticated SMTP must be allowed for the mailbox; many tenants turn basic auth off — connect with Microsoft sign-in instead." },
  "zoho.com": { imapHost: "imap.zoho.in", smtpHost: "smtp.zoho.in", note: "Zoho Mail (India data centre). Use imap.zoho.com / smtp.zoho.com for other regions." },
};
const presetFor = (address: string, host: string) => Object.entries(PRESETS).find(([d, p]) => address.endsWith(`@${d}`) || host === p.imapHost || host === p.smtpHost)?.[1];

/**
 * A workspace's own mailboxes: connect (IMAP/SMTP, or Google / Microsoft sign-in), test each
 * direction separately, choose the default sender, read now and disconnect. Sending and reading
 * are shown as separate facts, because each fails on its own.
 */
export function MailboxesPanel({ initial, canManage, notice = null, oauth }: { initial: Mailbox[]; canManage: boolean; notice?: string | null; oauth: Record<"gmail" | "microsoft", boolean> }) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "imap" | "smtp">(initial.length === 0 ? "smtp" : "none");
  const [form, setForm] = useState({ label: "", address: "", imapHost: "", imapPort: 993, imapUser: "", password: "", folder: "INBOX" });
  const [send, setSend] = useState({ label: "", address: "", fromName: "", smtpHost: "", smtpPort: 587, smtpUser: "", password: "" });
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(notice ?? "");
  const set = (k: keyof typeof form, v: string | number) => setForm(f => ({ ...f, [k]: v }));
  const setS = (k: keyof typeof send, v: string | number) => setSend(f => ({ ...f, [k]: v }));
  const preset = presetFor(form.address, form.imapHost); const sendPreset = presetFor(send.address, send.smtpHost);
  async function act(fn: () => Promise<{ note?: string }>) { setBusy(true); setMessage(""); try { const r = await fn(); if (r.note) setMessage(r.note); router.refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); } }
  const live = initial.filter(m => !m.revokedAt);

  return <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
    <div><h2 className="text-sm font-semibold text-primary">Mailboxes</h2>
      <p className="mt-0.5 text-xs text-secondary">The workspace&apos;s own mailboxes. A mailbox can send (sequences and replies go out as that address), be read for replies (read-only: nothing is marked read, moved or deleted), or both. A reply to something sent from here is added to its conversation and stops any sequence set to stop on reply; out-of-office answers and bounces are recorded but stop nothing. Without a sending mailbox, the server relay below is used.</p></div>
    {message && <p role="status" className="rounded border border-border p-2 text-xs">{message}</p>}
    {initial.length > 0 && <ul className="divide-y divide-border">{initial.map(m => {
      const cap = m.capability as Capability;
      return <li key={m.id} className="flex min-w-0 flex-wrap items-center gap-2 py-2 text-xs">
        <span className="min-w-0 flex-1 break-words"><span className="font-medium text-primary">{m.label}</span> · {m.address}
          <span className="text-secondary"> · {MAILBOX_PROVIDERS[m.provider as MailboxProvider]?.label ?? m.provider}{m.smtpHost ? ` · sends via ${m.smtpHost}:${m.smtpPort}` : ""}{m.imapHost ? ` · reads ${m.imapHost}:${m.imapPort}` : ""}{m.lastSyncedAt ? ` · read ${formatAge(m.lastSyncedAt)}` : ""} · {m.repliesMatched} {m.repliesMatched === 1 ? "reply" : "replies"} recorded</span>
          {m.sendLastError && <span className="block text-danger-text">Sending: {m.sendLastError}</span>}
          {m.lastError && <span className="block text-danger-text">Reading: {m.lastError}</span>}</span>
        <Badge variant={m.revokedAt ? "neutral" : CAPABILITY_VARIANT[cap]} size="sm">{m.revokedAt ? "Disconnected" : CAPABILITY_LABEL[cap]}</Badge>
        {m.isDefaultSender && !m.revokedAt && <Badge variant="success" size="sm">Default sender</Badge>}
        {canManage && !m.revokedAt && <>
          {(cap === "full" || cap === "receive_only") && <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api.post(`/api/mailboxes/${m.id}/sync`, {}))}>Read now</Button>}
          {m.provider === "imap" && m.imapHost && <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api.post(`/api/mailboxes/${m.id}/test`, {}))}>Test reading</Button>}
          {(m.sendStatus !== "NONE" || m.provider !== "imap") && <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api.post(`/api/mailboxes/${m.id}/test-sending`, {}))}>{m.provider === "imap" ? "Test sending" : "Test sign-in"}</Button>}
          {(cap === "full" || cap === "send_only") && !m.isDefaultSender && <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api.post(`/api/mailboxes/${m.id}/default`, {}))}>Make default sender</Button>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`Disconnect ${m.address}? Its passwords and sign-in are erased; it stops sending and being read. Replies already recorded stay.`)) void act(() => api.del(`/api/mailboxes/${m.id}`)); }}>Disconnect</Button>
        </>}
      </li>; })}</ul>}
    {!live.some(m => m.sendStatus === "CONNECTED") && <p className="text-xs text-secondary">No mailbox sends yet, so messages go through the server relay if one is configured, and are held otherwise.</p>}
    {!canManage && <p className="text-xs text-secondary">Only workspace managers can connect mailboxes.</p>}

    {canManage && <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {(["gmail", "microsoft"] as const).map(p => oauth[p]
          ? <a key={p} href={`/api/mailboxes/oauth/${p}/connect`} className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium text-primary hover:bg-surface-hover">Connect with {p === "gmail" ? "Google" : "Microsoft"}</a>
          : <Button key={p} size="sm" variant="outline" disabled title={MAILBOX_PROVIDERS[p].needs}>Connect with {p === "gmail" ? "Google" : "Microsoft"} — not set up</Button>)}
        <Button size="sm" variant={mode === "smtp" ? "primary" : "outline"} onClick={() => setMode(mode === "smtp" ? "none" : "smtp")}>Send with SMTP</Button>
        <Button size="sm" variant={mode === "imap" ? "primary" : "outline"} onClick={() => setMode(mode === "imap" ? "none" : "imap")}>Read replies with IMAP</Button>
      </div>
      {(!oauth.gmail || !oauth.microsoft) && <p className="text-2xs text-muted">Sign-in buttons need an OAuth app registered by whoever runs this server: {!oauth.gmail ? MAILBOX_PROVIDERS.gmail.needs : ""} {!oauth.microsoft ? MAILBOX_PROVIDERS.microsoft.needs : ""} Until then, use SMTP and IMAP with an app password.</p>}
    </div>}

    {canManage && mode === "smtp" && <form onSubmit={e => { e.preventDefault(); void act(async () => { const r = await api.post<{ note: string }>("/api/mailboxes/sending", { ...send, smtpPort: Number(send.smtpPort), fromName: send.fromName || null }); setSend(f => ({ ...f, password: "" })); setMode("none"); return r; }); }} className="grid gap-3 rounded border border-border p-3 md:grid-cols-2">
      <p className="text-xs font-medium text-primary md:col-span-2">Send from a mailbox over its own SMTP server</p>
      <label className="block text-xs">Name<Input required minLength={2} value={send.label} onChange={e => setS("label", e.target.value)} placeholder="Sales mailbox" className="mt-1" /></label>
      <label className="block text-xs">Email address<Input required type="email" value={send.address} onChange={e => { setS("address", e.target.value); if (!send.smtpUser) setS("smtpUser", e.target.value); }} className="mt-1" /></label>
      <label className="block text-xs">Name recipients see<Input value={send.fromName} onChange={e => setS("fromName", e.target.value)} placeholder="Priya from Acme" className="mt-1" /></label>
      <label className="block text-xs">SMTP server<Input required value={send.smtpHost} onChange={e => setS("smtpHost", e.target.value.trim())} placeholder={sendPreset?.smtpHost ?? "smtp.example.com"} className="mt-1" /></label>
      <label className="block text-xs">Port<Input required type="number" min={1} max={65535} value={send.smtpPort} onChange={e => setS("smtpPort", Number(e.target.value))} className="mt-1 max-w-28 tabular-nums" /><span className="text-2xs text-muted">465 = TLS; 587 = STARTTLS (required). Never sent in clear.</span></label>
      <label className="block text-xs">User name<Input required value={send.smtpUser} onChange={e => setS("smtpUser", e.target.value)} className="mt-1" /></label>
      <label className="block text-xs">Password or app password<Input required type="password" autoComplete="new-password" value={send.password} onChange={e => setS("password", e.target.value)} className="mt-1" /><span className="text-2xs text-muted">Encrypted on the server and never shown again.</span></label>
      {sendPreset && <p className="self-end text-2xs text-secondary">{sendPreset.note}</p>}
      <div className="flex gap-2 md:col-span-2"><Button type="submit" size="sm" disabled={busy}>Save and check</Button><Button type="button" size="sm" variant="ghost" onClick={() => setMode("none")}>Cancel</Button></div>
      <p className="text-2xs text-muted md:col-span-2">The check logs in and quits; it sends no message. To also read replies to this address, add IMAP for the same address.</p>
    </form>}

    {canManage && mode === "imap" && <form onSubmit={e => { e.preventDefault(); void act(async () => { const r = await api.post<{ note: string }>("/api/mailboxes", { ...form, imapPort: Number(form.imapPort), imapSecure: true }); setForm(f => ({ ...f, password: "" })); setMode("none"); return r; }); }} className="grid gap-3 rounded border border-border p-3 md:grid-cols-2">
      <p className="text-xs font-medium text-primary md:col-span-2">Read replies from a mailbox over IMAP</p>
      <label className="block text-xs">Name<Input required minLength={2} value={form.label} onChange={e => set("label", e.target.value)} placeholder="Sales inbox" className="mt-1" /></label>
      <label className="block text-xs">Email address<Input required type="email" value={form.address} onChange={e => { set("address", e.target.value); if (!form.imapUser) set("imapUser", e.target.value); }} className="mt-1" /></label>
      <label className="block text-xs">IMAP server<Input required value={form.imapHost} onChange={e => set("imapHost", e.target.value.trim())} placeholder={preset?.imapHost ?? "imap.example.com"} className="mt-1" /></label>
      <label className="block text-xs">Port (TLS)<Input required type="number" min={1} max={65535} value={form.imapPort} onChange={e => set("imapPort", Number(e.target.value))} className="mt-1 max-w-28 tabular-nums" /></label>
      <label className="block text-xs">User name<Input required value={form.imapUser} onChange={e => set("imapUser", e.target.value)} className="mt-1" /></label>
      <label className="block text-xs">Password or app password<Input required type="password" autoComplete="new-password" value={form.password} onChange={e => set("password", e.target.value)} className="mt-1" /><span className="text-2xs text-muted">Encrypted on the server and never shown again.</span></label>
      <label className="block text-xs">Folder<Input value={form.folder} onChange={e => set("folder", e.target.value)} className="mt-1" /></label>
      {preset && <p className="self-end text-2xs text-secondary">{preset.note}</p>}
      <div className="flex gap-2 md:col-span-2"><Button type="submit" size="sm" disabled={busy}>Connect and check</Button><Button type="button" size="sm" variant="ghost" onClick={() => setMode("none")}>Cancel</Button></div>
      <p className="text-2xs text-muted md:col-span-2">Only TLS connections are made (port 993 on most servers). Reading starts from the newest message, so mail already there is not treated as replies.</p>
    </form>}
  </section>;
}
