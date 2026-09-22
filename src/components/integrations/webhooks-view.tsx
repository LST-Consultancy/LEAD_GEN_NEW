"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Copy,
  Info,
  Lock,
  Plus,
  Radio,
  Send,
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
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatAge } from "@/lib/format";

type Hook = {
  id: string;
  name: string;
  url: string;
  events: { key: string; known: boolean; emitted: boolean; label: string }[];
  liveEvents: number;
  isActive: boolean;
  failureCount: number;
  lastDeliveryAt: string | null;
  deliveryCount: number;
  deliveries: {
    id: string;
    event: string;
    statusCode: number | null;
    attempt: number;
    error: string | null;
    outcome: string;
    createdAt: string;
  }[];
  createdAt: string;
};

type EventDef = { key: string; label: string; describes: string; emitted: boolean; note?: string };

const OUTCOME_VARIANT: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  delivered: "success",
  retrying: "warning",
  failed: "danger",
  pending: "neutral",
};

export function WebhooksView({
  hooks,
  catalogue,
  canManage,
}: {
  hooks: Hook[];
  catalogue: { events: EventDef[]; emittedCount: number; totalCount: number };
  canManage: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ value: string; note: string } | null>(null);

  const deaf = hooks.filter((h) => h.isActive && h.liveEvents === 0);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Webhooks</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Signed event delivery with retries and a delivery log. Every payload is HMAC-signed over
          a timestamp as well as the body, so a captured request cannot be replayed later.
        </p>
      </div>

      {deaf.length > 0 ? (
        <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5 text-xs text-warning-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          {deaf.length === 1
            ? `"${deaf[0].name}" is active but subscribed only to events nothing currently emits`
            : `${deaf.length} active endpoints are subscribed only to events nothing currently emits`}
          , so they will never fire. That is a silent misconfiguration, which is why it is named
          here.
        </div>
      ) : null}

      {secret ? (
        <Card className="border-success-border">
          <CardHeader>
            <CardTitle>Copy the signing secret now</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-surface-sunken px-2.5 py-2 font-mono text-xs text-primary">
                {secret.value}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void navigator.clipboard.writeText(secret.value)}
              >
                <Copy />
                Copy
              </Button>
            </div>
            <p className="text-2xs text-warning-text">
              <Lock className="mr-0.5 inline size-2.5" />
              {secret.note}
            </p>
            <p className="text-2xs text-muted">
              Verify it as{" "}
              <code className="font-mono">
                HMAC-SHA256(secret, `${"{timestamp}"}.${"{body}"}`)
              </code>{" "}
              and reject anything older than five minutes.
            </p>
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
              I have copied it
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        creating ? (
          <CreateForm
            catalogue={catalogue}
            onCancel={() => setCreating(false)}
            onCreated={(s) => {
              setSecret(s);
              setCreating(false);
            }}
          />
        ) : (
          <div>
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus />
              New endpoint
            </Button>
          </div>
        )
      ) : (
        <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-secondary">
          <Info className="mr-1 inline size-3" />
          Your role cannot manage webhooks.
        </div>
      )}

      {hooks.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Radio}
              title="No endpoints"
              description="A webhook posts a signed JSON payload to a URL you control whenever something happens here — a deal is won, a proposal is accepted, an agent holds an action for review."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {hooks.map((h) => (
            <HookCard key={h.id} hook={h} canManage={canManage} />
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Events you can subscribe to</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {catalogue.emittedCount} of {catalogue.totalCount} currently fire. The rest are
              listed with what is missing rather than left out.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border-subtle">
            {catalogue.events.map((e) => (
              <li key={e.key} className="flex flex-wrap items-baseline gap-2 px-4 py-2">
                <code className="font-mono text-2xs text-primary">{e.key}</code>
                {e.emitted ? (
                  <Badge variant="success" size="sm">
                    Emitted
                  </Badge>
                ) : (
                  <Tooltip content={e.note ?? "Nothing emits this yet."}>
                    <span className="cursor-help">
                      <Badge variant="warning" size="sm">
                        Not emitted
                      </Badge>
                    </span>
                  </Tooltip>
                )}
                <span className="min-w-0 flex-1 text-2xs text-secondary">{e.describes}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function HookCard({ hook, canManage }: { hook: Hook; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const act = async (fn: () => Promise<{ note: string }>) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fn();
      setMessage({ tone: "ok", text: res.note });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "That did not work." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-1.5">
            <span className="truncate">{hook.name}</span>
            {!hook.isActive ? (
              <Badge variant="neutral" size="sm">
                Paused
              </Badge>
            ) : null}
            {hook.failureCount > 0 ? (
              <Tooltip content="Consecutive failures. Delivery backs off as this climbs.">
                <span className="cursor-help">
                  <Badge variant="danger" size="sm">
                    {hook.failureCount} failing
                  </Badge>
                </span>
              </Tooltip>
            ) : null}
          </CardTitle>
          <p className="mt-0.5 truncate font-mono text-2xs text-muted">{hook.url}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {hook.events.map((e) => (
              <Tooltip
                key={e.key}
                content={
                  !e.known
                    ? "Not an event this app defines any more."
                    : e.emitted
                      ? e.label
                      : "Subscribed, but nothing emits this yet."
                }
              >
                <span
                  className={cn(
                    "cursor-help rounded px-1.5 py-0.5 font-mono text-2xs",
                    !e.known
                      ? "bg-danger-subtle text-danger-text line-through"
                      : e.emitted
                        ? "bg-success-subtle text-success-text"
                        : "bg-warning-surface text-warning-text"
                  )}
                >
                  {e.key}
                </span>
              </Tooltip>
            ))}
          </div>
        </div>

        {canManage ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Tooltip content="Sends a real request now. A failure here is the useful result.">
              <Button
                size="xs"
                variant="secondary"
                disabled={busy}
                onClick={() => void act(() => api.post(`/api/webhooks/${hook.id}/test`, {}))}
              >
                <Send />
                Test
              </Button>
            </Tooltip>
            <Switch
              checked={hook.isActive}
              disabled={busy}
              onCheckedChange={(v) =>
                void act(() => api.patch(`/api/webhooks/${hook.id}`, { isActive: v }))
              }
              aria-label={`${hook.isActive ? "Pause" : "Resume"} ${hook.name}`}
            />
            {confirming ? (
              <>
                <Button
                  size="xs"
                  variant="danger"
                  disabled={busy}
                  onClick={() => void act(() => api.del(`/api/webhooks/${hook.id}`))}
                >
                  Remove
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                  <X />
                </Button>
              </>
            ) : (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setConfirming(true)}
                aria-label={`Remove ${hook.name}`}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ) : null}
      </CardHeader>

      {message ? (
        <div className="px-4 pb-2">
          <p
            className={cn(
              "rounded-md px-2.5 py-2 text-2xs",
              message.tone === "ok"
                ? "border border-info-border bg-info-subtle text-info-text"
                : "border border-danger-border bg-danger-subtle text-danger-text"
            )}
          >
            {message.text}
          </p>
        </div>
      ) : null}

      <CardContent className="pt-0">
        {hook.deliveries.length === 0 ? (
          <p className="text-2xs text-muted">
            Nothing delivered yet{hook.liveEvents === 0 ? " — and nothing it listens for fires." : "."}
          </p>
        ) : (
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">
              Recent deliveries ({hook.deliveryCount} total)
            </p>
            <ul className="flex flex-col gap-0.5">
              {hook.deliveries.map((d) => (
                <li key={d.id} className="flex flex-wrap items-baseline gap-1.5 text-2xs">
                  <Badge variant={OUTCOME_VARIANT[d.outcome] ?? "neutral"} size="sm">
                    {d.outcome}
                  </Badge>
                  <code className="font-mono text-secondary">{d.event}</code>
                  {d.statusCode ? (
                    <span className="tabular text-muted">HTTP {d.statusCode}</span>
                  ) : null}
                  {d.attempt > 1 ? (
                    <span className="text-muted">attempt {d.attempt}</span>
                  ) : null}
                  <span className="text-muted">{formatAge(d.createdAt)}</span>
                  {d.error ? <span className="text-danger-text">{d.error}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreateForm({
  catalogue,
  onCancel,
  onCreated,
}: {
  catalogue: { events: EventDef[] };
  onCancel: () => void;
  onCreated: (s: { value: string; note: string }) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dead = [...chosen].filter((k) => !catalogue.events.find((e) => e.key === k)?.emitted);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ secret: string; note: string }>("/api/webhooks", {
        name,
        url,
        events: [...chosen],
      });
      onCreated({ value: res.secret, note: res.note });
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
        <CardTitle>New endpoint</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="hook-name">Name</Label>
          <Input
            id="hook-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ops Slack relay"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="hook-url">URL</Label>
          <Input
            id="hook-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.example.com/signalroom"
          />
          <p className="text-2xs text-muted">
            Must be https — payloads carry lead and deal data.
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">
            Events
          </p>
          <div className="flex flex-col gap-1">
            {catalogue.events.map((e) => (
              <label key={e.key} className="flex items-start gap-2">
                <Checkbox
                  checked={chosen.has(e.key)}
                  onCheckedChange={(v) => {
                    const next = new Set(chosen);
                    if (v) next.add(e.key);
                    else next.delete(e.key);
                    setChosen(next);
                  }}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <code className="font-mono text-2xs text-primary">{e.key}</code>
                    {!e.emitted ? (
                      <Badge variant="warning" size="sm">
                        Not emitted
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block text-2xs text-secondary">{e.describes}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {dead.length > 0 ? (
          <p className="rounded-md border border-warning-border bg-warning-surface px-2.5 py-2 text-2xs text-warning-text">
            <AlertTriangle className="mr-1 inline size-3" />
            {dead.join(", ")} {dead.length === 1 ? "is" : "are"} not emitted yet, so this endpoint
            will hear nothing from {dead.length === 1 ? "it" : "them"}.
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
            disabled={busy || name.trim().length < 2 || url.trim().length < 8 || chosen.size === 0}
            onClick={() => void submit()}
          >
            <Check />
            Create and show the secret once
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
