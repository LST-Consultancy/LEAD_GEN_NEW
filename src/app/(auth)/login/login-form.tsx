"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";

export function LoginForm({ demo }: { demo: { email: string; password: string } | null }) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "We couldn't sign you in. Please try again.");
        return;
      }
      router.push(data.redirectTo ?? "/today");
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  function fillDemo() {
    if (!demo) return;
    setEmail(demo.email);
    setPassword(demo.password);
    setError(null);
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight text-primary">Sign in</h2>
        <p className="text-sm text-secondary">Pick up where your pipeline left off.</p>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Work email" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            aria-invalid={error ? true : undefined}
            className="h-9"
          />
        </Field>

        <Field label="Password" htmlFor="password" required>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            className="h-9"
          />
        </Field>

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger-text"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </div>
        ) : null}

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
          {pending ? "Signing in…" : "Sign in"}
          {!pending && <ArrowRight />}
        </Button>
      </form>

      {demo ? (
      <div className="rounded-lg border border-dashed border-border-strong bg-surface-sunken p-3.5">
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted">Demo workspace</p>
        <p className="mt-1.5 text-xs leading-relaxed text-secondary">
          A seeded workspace with 132 fictional leads, 34 deals and a full activity history.
        </p>
        <dl className="mt-2.5 space-y-0.5 font-mono text-2xs text-secondary">
          <div className="flex gap-2">
            <dt className="text-muted">email</dt>
            <dd>{demo.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">pass</dt>
            <dd>{demo.password}</dd>
          </div>
        </dl>
        <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={fillDemo} type="button">
          Fill demo credentials
        </Button>
      </div>
      ) : null}
    </div>
  );
}
