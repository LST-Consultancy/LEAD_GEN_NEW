"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, KeyRound, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { api } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import type { MfaStatus } from "@/lib/services/mfa";

/**
 * §104 — second-factor enrolment.
 *
 * Enrolment is two steps on purpose: the secret is stored when you start, but
 * nothing is enforced until a code from the app proves it was scanned
 * correctly. A one-step version locks out anyone who mistyped the key, and they
 * only find out at their next sign-in.
 */
export function MfaPanel({ status }: { status: MfaStatus }) {
  const router = useRouter();
  const [stage, setStage] = React.useState<"idle" | "enrolling" | "codes">("idle");
  const [secret, setSecret] = React.useState<string | null>(null);
  const [uri, setUri] = React.useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([]);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ secret: string; uri: string }>("/api/auth/mfa");
      setSecret(res.secret);
      setUri(res.uri);
      setStage("enrolling");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start setup. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.put<{ recoveryCodes: string[] }>("/api/auth/mfa", { code });
      setRecoveryCodes(res.recoveryCodes);
      setCode("");
      setStage("codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code wasn't accepted.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await api.del("/api/auth/mfa", { code });
      setCode("");
      setStage("idle");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code wasn't accepted.");
    } finally {
      setBusy(false);
    }
  }

  // ---- already on -------------------------------------------------------
  if (status.enabled && stage !== "codes") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="success" size="sm">
            <Check className="size-2.5" />
            On
          </Badge>
          {status.enrolledAt ? (
            <span className="text-2xs text-muted">since {formatDate(status.enrolledAt)}</span>
          ) : null}
          <Tooltip content="Each one works once. Generating a new set replaces every unused code.">
            <span className="cursor-help text-2xs text-muted">
              · {status.recoveryCodesRemaining} recovery{" "}
              {status.recoveryCodesRemaining === 1 ? "code" : "codes"} left
            </span>
          </Tooltip>
        </div>

        {status.recoveryCodesRemaining <= 2 ? (
          <div className="flex gap-2 rounded-md border border-warning-border bg-warning-subtle p-2.5 text-2xs leading-relaxed text-warning-text">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Only {status.recoveryCodesRemaining} recovery{" "}
              {status.recoveryCodesRemaining === 1 ? "code" : "codes"} left. If you run out and lose
              your device, nobody here can let you back in — turn it off and on again to get a fresh
              set while you still can.
            </span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label
              htmlFor="mfa-off"
              className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted"
            >
              Turn off
            </label>
            <Input
              id="mfa-off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Six-digit or recovery code"
              className="max-w-52 font-mono"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </div>
          <Button size="sm" variant="danger" disabled={busy || !code.trim()} onClick={() => void disable()}>
            {busy ? "Checking…" : "Turn off"}
          </Button>
        </div>
        <p className="text-2xs leading-relaxed text-muted">
          A code is required to turn this off. A session on its own isn&apos;t enough — otherwise a
          stolen session could remove the very thing protecting against one.
        </p>
        {error ? (
          <p className="rounded-md border border-danger-border bg-danger-subtle p-2 text-2xs text-danger-text">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  // ---- recovery codes, shown exactly once -------------------------------
  if (stage === "codes") {
    return (
      <div className="space-y-2">
        <div className="flex gap-2 rounded-md border border-warning-border bg-warning-subtle p-2.5 text-2xs leading-relaxed text-warning-text">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong>Save these now — this is the only time they can be shown.</strong> Only their
            hashes are stored, exactly like a password, so nobody here can read them back to you.
            Each works once, and they are what gets you in if you lose your device.
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {recoveryCodes.map((c) => (
            <code
              key={c}
              className="rounded border border-border bg-surface-sunken px-2 py-1 text-center font-mono text-2xs text-primary"
            >
              {c}
            </code>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(recoveryCodes.join("\n"));
              setCopied(true);
            }}
          >
            <Copy />
            {copied ? "Copied" : "Copy all"}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setStage("idle");
              setRecoveryCodes([]);
              router.refresh();
            }}
          >
            I&apos;ve saved them
          </Button>
        </div>
      </div>
    );
  }

  // ---- enrolling --------------------------------------------------------
  if (stage === "enrolling" && secret) {
    return (
      <div className="space-y-2">
        <p className="text-2xs leading-relaxed text-secondary">
          Add this key to your authenticator app, then enter the code it shows.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="select-all rounded border border-border bg-surface-sunken px-2 py-1 font-mono text-xs tracking-widest text-primary">
            {secret.match(/.{1,4}/g)?.join(" ")}
          </code>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(secret);
              setCopied(true);
            }}
          >
            <Copy />
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-2xs leading-relaxed text-muted">
          There is no QR code to scan — rendering one needs an encoder this app doesn&apos;t carry,
          so the key is typed in by hand instead. Every authenticator app accepts a manual key.
          {uri ? " The setup URI is the same value in link form." : ""}
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label
              htmlFor="mfa-code"
              className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted"
            >
              Code from your app
            </label>
            <Input
              id="mfa-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
              className="max-w-32 font-mono tracking-widest"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
            />
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || code.trim().length < 6}
            onClick={() => void confirm()}
          >
            {busy ? "Checking…" : "Turn on"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStage("idle")}>
            Cancel
          </Button>
        </div>
        {error ? (
          <p className="rounded-md border border-danger-border bg-danger-subtle p-2 text-2xs text-danger-text">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  // ---- off --------------------------------------------------------------
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="neutral" size="sm">
          Off
        </Badge>
        {status.pendingConfirmation ? (
          <Tooltip content="A setup was started but never confirmed, so nothing is enforced. Starting again issues a fresh key.">
            <span className="cursor-help">
              <Badge variant="warning" size="sm">
                Setup unfinished
              </Badge>
            </span>
          </Tooltip>
        ) : null}
      </div>
      <p className="text-2xs leading-relaxed text-secondary">
        A password alone is one thing someone can steal. With this on, signing in also needs a code
        from your phone that changes every thirty seconds and only works once.
      </p>
      <Button size="sm" variant="primary" disabled={busy} onClick={() => void begin()}>
        <ShieldCheck />
        {busy ? "Starting…" : status.pendingConfirmation ? "Start again" : "Set up"}
      </Button>
      {error ? (
        <p className="rounded-md border border-danger-border bg-danger-subtle p-2 text-2xs text-danger-text">
          {error}
        </p>
      ) : null}
      <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-muted">
        <KeyRound className="mt-0.5 size-3 shrink-0" />
        Recovery codes are issued when you finish, and shown only that once.
      </p>
    </div>
  );
}
