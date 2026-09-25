"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { whatsappStatus } from "@/lib/services/whatsapp";

type Status = Awaited<ReturnType<typeof whatsappStatus>>;

/** Connect the workspace's own WhatsApp Business number through Meta's Cloud API. Secrets are write-only. */
export function WhatsAppConnection({ status, canManage }: { status: Status; canManage: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ phoneNumberId: status.phoneNumberId ?? "", businessAccountId: status.businessAccountId ?? "", accessToken: "", appSecret: "", verifyToken: "", apiVersion: status.apiVersion });
  const [open, setOpen] = useState(!status.connected); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));
  async function save() {
    setBusy(true); setMessage("");
    try { const r = await api.post<{ note: string }>("/api/whatsapp/connection", { ...form, accessToken: form.accessToken || undefined, appSecret: form.appSecret || undefined }); setMessage(r.note); setForm(f => ({ ...f, accessToken: "", appSecret: "" })); setOpen(false); router.refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  }
  async function disconnect() {
    if (!window.confirm("Disconnect WhatsApp? The token and app secret are erased and nothing will send or be received until it is connected again.")) return;
    setBusy(true); try { const r = await api.del<{ note: string }>("/api/whatsapp/connection"); setMessage(r.note); router.refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not disconnect."); } finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-lg border border-border bg-surface p-4 text-xs">
    <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-primary">Cloud API connection</h2>
      <Badge variant={status.connected ? (status.status === "ERROR" ? "danger" : "success") : "neutral"} size="sm">{status.connected ? (status.status === "ERROR" ? "Check failed" : "Connected") : "Not connected"}</Badge>
      {status.display && <span className="text-secondary">{status.display}</span>}</div>
    <p className="text-secondary">Your own WhatsApp Business number, through Meta&apos;s official API. Messages go only to people who opted in (recorded on the lead) or who messaged you first; free text only within 24 hours of their last message, otherwise an approved template. Replies, receipts and STOP messages arrive through the webhook below and stop sequences or suppress the number on every channel.</p>
    <p className="break-words text-secondary">Webhook URL for Meta: <code className="text-primary">https://&lt;your domain&gt;{status.webhookPath}</code> — subscribe to the <code>messages</code> field and use the verify token you set here.</p>
    {message && <p role="status" className="rounded border border-border p-2">{message}</p>}
    {canManage && status.connected && !open && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setOpen(true)}>Edit connection</Button><Button size="sm" variant="ghost" disabled={busy} onClick={disconnect}>Disconnect</Button></div>}
    {!canManage && <p className="text-secondary">Only workspace managers can change the connection.</p>}
    {canManage && open && <form onSubmit={e => { e.preventDefault(); void save(); }} className="grid gap-3 md:grid-cols-2">
      <label className="block">Phone number ID<Input required value={form.phoneNumberId} onChange={e => set("phoneNumberId", e.target.value.trim())} className="mt-1 font-mono" /></label>
      <label className="block">WhatsApp Business Account ID<Input required value={form.businessAccountId} onChange={e => set("businessAccountId", e.target.value.trim())} className="mt-1 font-mono" /></label>
      <label className="block">System-user access token<Input type="password" autoComplete="new-password" required={!status.connected} value={form.accessToken} onChange={e => set("accessToken", e.target.value)} placeholder={status.connected ? "Leave blank to keep the saved token" : ""} className="mt-1" /></label>
      <label className="block">App secret<Input type="password" autoComplete="new-password" required={!status.connected} value={form.appSecret} onChange={e => set("appSecret", e.target.value)} placeholder={status.connected ? "Leave blank to keep the saved secret" : ""} className="mt-1" /><span className="text-2xs text-muted">Verifies that webhook deliveries come from Meta.</span></label>
      <label className="block">Webhook verify token<Input required minLength={12} value={form.verifyToken} onChange={e => set("verifyToken", e.target.value)} placeholder="A long random string you choose" className="mt-1" /></label>
      <label className="block">Graph API version<Input value={form.apiVersion} onChange={e => set("apiVersion", e.target.value.trim())} className="mt-1 max-w-28 font-mono" /></label>
      <div className="flex gap-2 md:col-span-2"><Button type="submit" size="sm" disabled={busy}>Connect and check</Button>{status.connected && <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}</div>
      <p className="text-2xs text-muted md:col-span-2">The check reads the number&apos;s name and quality rating from Meta; it sends nothing and costs nothing. Secrets are encrypted and never shown again.</p>
    </form>}
  </section>;
}
