"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";

export function AcceptInvitationForm({ token, email, workspaceName, roleName, hasAccount, signedInEmail }: {
  token: string; email: string; workspaceName: string; roleName: string; hasAccount: boolean; signedInEmail: string | null;
}) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const signedInAsInvitee = signedInEmail?.toLowerCase() === email.toLowerCase();

  async function accept(e?: React.FormEvent) {
    e?.preventDefault();
    setPending(true); setError(null);
    try {
      const res = await fetch("/api/auth/invitation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(hasAccount ? { token } : { token, name, password }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error?.message ?? "That didn't work. Nothing was changed."); return; }
      router.push(data.redirectTo ?? "/today"); router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally { setPending(false); }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight text-primary">Join {workspaceName}</h1>
        <p className="text-sm text-secondary">You&apos;ve been invited as <strong className="text-primary">{roleName}</strong>, for <span className="text-primary">{email}</span>.</p>
      </div>

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger-text">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{error}
        </p>
      ) : null}

      {hasAccount ? (
        signedInAsInvitee ? (
          <Button variant="primary" className="w-full" loading={pending} onClick={() => void accept()}>Accept and open {workspaceName}</Button>
        ) : (
          <div className="space-y-2 text-sm text-secondary">
            <p>{email} already has an account. {signedInEmail ? `You're signed in as ${signedInEmail}, so` : "Sign in as that address, then"} open this link again to accept.</p>
            <Link href="/login" className="text-brand-text hover:underline">Sign in</Link>
          </div>
        )
      ) : (
        <form onSubmit={accept} className="space-y-4" noValidate>
          <Field label="Your name" htmlFor="invite-name" required>
            <Input id="invite-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Choose a password" htmlFor="invite-password" required hint="At least 10 characters, with upper- and lower-case letters and a number.">
            <Input id="invite-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={pending} disabled={name.trim().length < 2 || password.length === 0}>Create account and join</Button>
        </form>
      )}
    </div>
  );
}
