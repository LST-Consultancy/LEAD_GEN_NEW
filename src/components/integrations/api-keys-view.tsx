"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Copy,
  Info,
  Key,
  Lock,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatAge } from "@/lib/format";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: { key: string; label: string; risk: string | null; known: boolean }[];
  highestRisk: string | null;
  state: string;
  stateReason: string | null;
  creatorName: string | null;
  creatorRole: string | null;
  withheld: string[];
  endpointCount: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type Scope = {
  key: string;
  label: string;
  risk: string;
  describes: string;
  grantable: boolean;
  missing: string[];
  endpoints: number;
};

type Endpoint = {
  method: string;
  path: string;
  summary: string;
  scope: string | null;
  keyAuth: boolean;
  note?: string;
};

const RISK_VARIANT: Record<string, "neutral" | "info" | "warning" | "danger"> = {
  READ: "neutral",
  WRITE: "info",
  SPEND: "warning",
  EXTERNAL: "danger",
};

const STATE_META: Record<string, { label: string; variant: "success" | "neutral" | "warning" | "danger" }> = {
  active: { label: "Active", variant: "success" },
  revoked: { label: "Revoked", variant: "neutral" },
  expired: { label: "Expired", variant: "warning" },
  orphaned: { label: "Orphaned", variant: "danger" },
  powerless: { label: "Powerless", variant: "danger" },
};

export function ApiKeysView({
  keys,
  surface,
  canManage,
}: {
  keys: KeyRow[];
  surface: { scopes: Scope[]; endpoints: Endpoint[]; keyEndpointCount: number; totalEndpointCount: number };
  canManage: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ plaintext: string; note: string; endpoints: Endpoint[] } | null>(
    null
  );

  const live = keys.filter((k) => k.state === "active");
  const broken = keys.filter((k) => k.state === "orphaned" || k.state === "powerless");

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">API Keys</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Named, scoped, expirable keys for machine callers. A key runs through the same
          permission checks and tenant scoping a person does — it is never a separate way into
          your data, only a narrower one.
        </p>
      </div>

      {broken.length > 0 ? (
        <div className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-xs text-danger-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>
            {broken.length === 1 ? "One key no longer works" : `${broken.length} keys no longer work`}
          </strong>{" "}
          even though nobody revoked them — the person who created them left, or lost the
          permissions the scopes need. Anything using them is failing right now.
        </div>
      ) : null}

      {issued ? (
        <Card className="border-success-border">
          <CardHeader>
            <CardTitle>Copy this now</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-surface-sunken px-2.5 py-2 font-mono text-xs text-primary">
                {issued.plaintext}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void navigator.clipboard.writeText(issued.plaintext)}
              >
                <Copy />
                Copy
              </Button>
            </div>
            <p className="text-2xs text-warning-text">
              <Lock className="mr-0.5 inline size-2.5" />
              {issued.note}
            </p>
            {issued.endpoints.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-2xs text-muted">
                  What this key can call ({issued.endpoints.length} endpoints)
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {issued.endpoints.map((e) => (
                    <li key={`${e.method}${e.path}`} className="font-mono text-2xs text-secondary">
                      {e.method} {e.path}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
              I have copied it
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        creating ? (
          <CreateForm
            scopes={surface.scopes}
            onCancel={() => setCreating(false)}
            onCreated={(r) => {
              setIssued(r);
              setCreating(false);
            }}
          />
        ) : (
          <div>
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus />
              New key
            </Button>
          </div>
        )
      ) : (
        <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-secondary">
          <Info className="mr-1 inline size-3" />
          Your role cannot manage API keys. You can see which exist and what they reach.
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Keys</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {live.length} active of {keys.length}.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {keys.length === 0 ? (
            <EmptyState
              icon={Key}
              title="No keys yet"
              description="A key lets a script, a data warehouse or another tool read and change things here under a named, scoped credential that you can revoke on its own."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {keys.map((k) => (
                <KeyItem key={k.id} row={k} canManage={canManage} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <SurfaceCard surface={surface} />
    </div>
  );
}

function KeyItem({ row, canManage }: { row: KeyRow; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = STATE_META[row.state] ?? STATE_META.active;

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/api-keys/${row.id}`);
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="px-4 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-primary">{row.name}</span>
            <Badge variant={meta.variant} size="sm">
              {meta.label}
            </Badge>
            {row.highestRisk && row.state === "active" ? (
              <Tooltip content={`The riskiest thing this key can do is ${row.highestRisk.toLowerCase()}.`}>
                <span className="cursor-help">
                  <Badge variant={RISK_VARIANT[row.highestRisk] ?? "neutral"} size="sm">
                    {row.highestRisk}
                  </Badge>
                </span>
              </Tooltip>
            ) : null}
            <code className="font-mono text-2xs text-muted">{row.prefix}…</code>
          </div>
          <p className="mt-0.5 text-2xs text-muted">
            {row.creatorName ? `Created by ${row.creatorName}` : "Creator unknown"}
            {row.creatorRole ? ` (${row.creatorRole})` : ""} · {formatAge(row.createdAt)} ·{" "}
            {row.lastUsedAt ? `last used ${formatAge(row.lastUsedAt)}` : "never used"}
            {row.expiresAt ? ` · expires ${new Date(row.expiresAt).toLocaleDateString("en-IN")}` : " · never expires"}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {row.scopes.map((s) => (
              <Tooltip
                key={s.key}
                content={s.known ? `${s.label} — ${s.risk}` : "Not a scope this app defines any more."}
              >
                <span
                  className={cn(
                    "cursor-help rounded px-1.5 py-0.5 font-mono text-2xs",
                    !s.known
                      ? "bg-danger-subtle text-danger-text line-through"
                      : "bg-surface-sunken text-secondary"
                  )}
                >
                  {s.key}
                </span>
              </Tooltip>
            ))}
            <span className="text-2xs text-muted">{row.endpointCount} endpoints</span>
          </div>
          {row.stateReason ? (
            <p className="mt-1 text-2xs text-warning-text">
              <AlertTriangle className="mr-0.5 inline size-2.5" />
              {row.stateReason}
            </p>
          ) : null}
          {error ? <p className="mt-1 text-2xs text-danger-text">{error}</p> : null}
        </div>

        {canManage && row.state !== "revoked" ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {confirming ? (
              <>
                <span className="text-2xs text-danger-text">
                  {row.lastUsedAt ? "Anything using it will start failing." : "It was never used."}
                </span>
                <Button size="xs" variant="danger" disabled={busy} onClick={() => void revoke()}>
                  Revoke
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Tooltip content="Stops the key working immediately. This cannot be undone.">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => setConfirming(true)}
                  aria-label={`Revoke ${row.name}`}
                >
                  <Trash2 />
                </Button>
              </Tooltip>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function CreateForm({
  scopes,
  onCancel,
  onCreated,
}: {
  scopes: Scope[];
  onCancel: () => void;
  onCreated: (r: { plaintext: string; note: string; endpoints: Endpoint[] }) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [expiry, setExpiry] = useState<string>("90");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = scopes.filter((s) => chosen.has(s.key));
  const risky = selected.filter((s) => s.risk === "SPEND" || s.risk === "EXTERNAL");

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ plaintext: string; note: string; endpoints: Endpoint[] }>(
        "/api/api-keys",
        {
          name,
          scopes: [...chosen],
          expiresInDays: expiry === "never" ? null : Number(expiry),
        }
      );
      onCreated(res);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>New key</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="key-name">Name</Label>
          <Input
            id="key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Warehouse sync"
          />
          <p className="text-2xs text-muted">This is how you will recognise it when revoking.</p>
        </div>

        <div>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">
            What it may do
          </p>
          <div className="flex flex-col gap-1.5">
            {scopes.map((s) => (
              <label
                key={s.key}
                className={cn(
                  "flex items-start gap-2 rounded-md border px-2.5 py-2",
                  !s.grantable
                    ? "border-border-subtle bg-surface-sunken opacity-60"
                    : chosen.has(s.key)
                      ? "border-accent bg-accent-subtle"
                      : "border-border-subtle bg-surface"
                )}
              >
                <Checkbox
                  checked={chosen.has(s.key)}
                  disabled={!s.grantable}
                  onCheckedChange={(v) => {
                    const next = new Set(chosen);
                    if (v) next.add(s.key);
                    else next.delete(s.key);
                    setChosen(next);
                  }}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-primary">{s.label}</span>
                    <Badge variant={RISK_VARIANT[s.risk] ?? "neutral"} size="sm">
                      {s.risk}
                    </Badge>
                    <code className="font-mono text-2xs text-muted">{s.key}</code>
                    <span className="text-2xs text-muted">{s.endpoints} endpoints</span>
                  </div>
                  <p className="mt-0.5 text-2xs text-secondary">{s.describes}</p>
                  {!s.grantable ? (
                    <p className="mt-0.5 text-2xs text-warning-text">
                      Your role cannot grant this — a key can never do more than the person who
                      created it.
                    </p>
                  ) : null}
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="key-expiry">Expires</Label>
          <select
            id="key-expiry"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-primary focus:border-accent focus:outline-none"
          >
            <option value="30">in 30 days</option>
            <option value="90">in 90 days</option>
            <option value="365">in a year</option>
            <option value="never">never</option>
          </select>
          {expiry === "never" ? (
            <p className="text-2xs text-warning-text">
              A key that never expires can only be stopped by revoking it. Prefer a date.
            </p>
          ) : null}
        </div>

        {risky.length > 0 ? (
          <p className="rounded-md border border-warning-border bg-warning-surface px-2.5 py-2 text-2xs text-warning-text">
            <ShieldAlert className="mr-1 inline size-3" />
            This key will be able to{" "}
            {risky.map((s) => s.label.toLowerCase()).join(" and ")}. Anything holding it can spend
            points or reach people outside the app without further confirmation.
          </p>
        ) : null}

        {error ? (
          <p className="rounded-md border border-danger-border bg-danger-subtle px-2.5 py-2 text-2xs text-danger-text">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={busy || name.trim().length < 2 || chosen.size === 0}
            onClick={() => void submit()}
          >
            <Key />
            Create and show once
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X />
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SurfaceCard({
  surface,
}: {
  surface: { endpoints: Endpoint[]; keyEndpointCount: number; totalEndpointCount: number };
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>What a key can reach</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            {surface.keyEndpointCount} of {surface.totalEndpointCount} documented endpoints accept
            a key. The rest say why not, rather than being left undocumented.
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border-subtle">
          {surface.endpoints.map((e) => (
            <li key={`${e.method}${e.path}`} className="flex flex-wrap items-baseline gap-2 px-4 py-2">
              <span
                className={cn(
                  "w-14 shrink-0 font-mono text-2xs font-semibold",
                  e.method === "GET" ? "text-info-text" : "text-warning-text"
                )}
              >
                {e.method}
              </span>
              <code className="font-mono text-2xs text-primary">{e.path}</code>
              {e.keyAuth ? (
                <Badge variant="success" size="sm">
                  {e.scope}
                </Badge>
              ) : (
                <Tooltip content={e.note ?? "Not available to keys."}>
                  <span className="cursor-help">
                    <Badge variant="neutral" size="sm">
                      Session only
                    </Badge>
                  </span>
                </Tooltip>
              )}
              <span className="min-w-0 flex-1 text-2xs text-muted">{e.summary}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
