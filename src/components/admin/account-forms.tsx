"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api/client";

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Nothing was changed.");
const LOCALES = [["en-IN", "English (India)"], ["en-GB", "English (UK)"], ["en-US", "English (US)"], ["hi-IN", "Hindi (India)"]] as const;

export function ProfileForm({ initial }: { initial: { name: string; timezone: string; locale: string } }) {
  const router = useRouter();
  const [form, setForm] = React.useState(initial);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  // Read after mount: Node and the browser can ship different zone lists, and a
  // difference between the two renders is a hydration mismatch.
  const [zones, setZones] = React.useState<string[]>([]);
  React.useEffect(() => setZones(Intl.supportedValuesOf("timeZone")), []);
  const changed = (Object.keys(form) as (keyof typeof form)[]).filter((k) => form[k] !== initial[k]);

  async function save() {
    setPending(true); setError("");
    try {
      await api.patch("/api/account/profile", Object.fromEntries(changed.map((k) => [k, form[k]])));
      toast.success("Profile saved"); router.refresh();
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" htmlFor="ac-name"><Input id="ac-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} /></Field>
        <Field label="Timezone" htmlFor="ac-tz">
          <select id="ac-tz" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
            {!zones.includes(form.timezone) ? <option value={form.timezone}>{form.timezone}</option> : null}
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </Field>
        <Field label="Language" htmlFor="ac-locale">
          <select id="ac-locale" value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
            {!LOCALES.some(([v]) => v === form.locale) ? <option value={form.locale}>{form.locale}</option> : null}
            {LOCALES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>
      {error ? <p className="text-xs text-danger-text">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={!changed.length || pending} onClick={() => { setForm(initial); setError(""); }}>Cancel</Button>
        <Button variant="primary" size="sm" loading={pending} disabled={!changed.length || form.name.trim().length < 2} onClick={() => void save()}>Save profile</Button>
      </div>
    </div>
  );
}

export function PasswordForm() {
  const router = useRouter();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true); setError("");
    try {
      const r = await api.post<{ otherSessionsSignedOut: number }>("/api/account/password", { current, next, confirm });
      toast.success("Password changed", { description: r.otherSessionsSignedOut ? `${r.otherSessionsSignedOut} other ${r.otherSessionsSignedOut === 1 ? "session was" : "sessions were"} signed out.` : "No other sessions were signed in." });
      setCurrent(""); setNext(""); setConfirm(""); router.refresh();
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Current password" htmlFor="pw-current"><Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="New password" htmlFor="pw-next" hint="10+ characters, upper and lower case, a number."><Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" error={mismatch ? "Doesn't match." : undefined}><Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      </div>
      {error ? <p className="text-xs text-danger-text">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <p className="mr-auto text-2xs text-muted">Changing it signs out your other sessions; this one stays signed in.</p>
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={!current || !next || mismatch}>Change password</Button>
      </div>
    </form>
  );
}

export function RevokeSessionButton({ sessionId, current }: { sessionId: string; current: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  async function revoke() {
    setPending(true);
    try {
      await api.del(`/api/account/sessions/${sessionId}`);
      if (current) { window.location.href = "/login"; return; }
      toast.success("Session signed out"); router.refresh();
    } catch (err) { toast.error("Couldn't sign it out", { description: errorText(err) }); } finally { setPending(false); }
  }
  return <Button variant="ghost" size="xs" loading={pending} onClick={() => void revoke()}>{current ? "Sign out" : "Sign out device"}</Button>;
}

export function RevokeOtherSessionsButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  if (count === 0) return null;
  async function revoke() {
    setPending(true);
    try { const r = await api.del<{ count: number }>("/api/account/sessions"); toast.success(`${r.count} other ${r.count === 1 ? "session" : "sessions"} signed out`); router.refresh(); }
    catch (err) { toast.error("Couldn't sign them out", { description: errorText(err) }); } finally { setPending(false); }
  }
  return <Button variant="secondary" size="sm" loading={pending} onClick={() => void revoke()}>Sign out all other sessions</Button>;
}
