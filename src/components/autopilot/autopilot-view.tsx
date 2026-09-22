"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  Check,
  Gauge,
  Info,
  Play,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { DAY_NAME } from "@/lib/outreach/sendability";

type Settings = {
  mode: "OFF" | "REVIEW_FIRST" | "FULL_AUTO";
  maxLeadsPerDay: number;
  maxRevealsPerDay: number;
  maxPointsPerDay: number;
  maxEmailsPerDay: number;
  maxWhatsappPerDay: number;
  maxLinkedinPerDay: number;
  allowedTiers: string[];
  minScore: number;
  allowedIndustries: string[];
  allowedLocations: string[];
  allowedChannels: string[];
  sendWindowStart: number;
  sendWindowEnd: number;
  sendDays: number[];
  blockedDomains: string[];
  blockedCompanies: string[];
  approvalThresholdInr: number;
  requireApprovalForSpend: boolean;
};

type Agent = {
  id: string;
  kind: string;
  name: string;
  goal: string;
  isEnabled: boolean;
  approvalPolicy: string;
  dailyPointBudget: number;
  dailyActionCap: number;
  tools: { name: string; known: boolean; implemented: boolean }[];
  health: { usable: number; unknown: string[]; unbuilt: string[]; inert: boolean };
  usedToday: { points: number; actions: number };
  runCount: number;
  blockedBecause: string | null;
};

type PendingAction = {
  id: string;
  tool: string;
  riskClass: string;
  summary: string;
  pointsSpent: number;
  occurredAt: string;
  agent: { id: string; name: string; kind: string };
  trigger: string;
  executable: boolean;
};

type DryRun = {
  agent: { id: string; name: string };
  consideredAction: { tool: string; riskClass: string; known: boolean; implemented: boolean } | null;
  examined: number;
  tally: Record<string, number>;
  rows: {
    leadId: string;
    name: string;
    company: string;
    tier: string;
    score: number | null;
    disposition: string;
    headline: string;
    guards: { code: string; message: string; disposition: string }[];
  }[];
  note: string;
};

const MODES = [
  {
    key: "OFF",
    label: "Off",
    icon: Ban,
    blurb: "Agents may read your data to answer questions. They cannot change or send anything.",
  },
  {
    key: "REVIEW_FIRST",
    label: "Review first",
    icon: ShieldCheck,
    blurb: "Agents do the work and hold the effect. A person approves every action.",
  },
  {
    key: "FULL_AUTO",
    label: "Full auto",
    icon: ShieldAlert,
    blurb: "Agents act without asking, within the limits below.",
  },
] as const;

const DISPOSITION_META: Record<
  string,
  { label: string; variant: "success" | "warning" | "neutral" | "danger"; meaning: string }
> = {
  allow: { label: "Would act", variant: "success", meaning: "Nothing stands in the way." },
  approve: {
    label: "Would ask",
    variant: "warning",
    meaning: "The work would be done but held until a person approves it.",
  },
  defer: {
    label: "Would wait",
    variant: "neutral",
    meaning: "A limit the clock resets — a daily cap or a send window.",
  },
  refuse: {
    label: "Would refuse",
    variant: "danger",
    meaning: "This can never happen as configured.",
  },
};

export function AutopilotView({
  config,
  agents,
  pending,
}: {
  config: { settings: Settings; configured: boolean; policy: string[]; aiConfigured: boolean; aiMessage: string };
  agents: Agent[];
  pending: PendingAction[];
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(config.settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [policy, setPolicy] = useState(config.policy);

  const save = async (next: Settings) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.put<{ settings: Settings; policy: string[]; note: string }>(
        "/api/autopilot",
        next
      );
      setSettings(res.settings);
      setPolicy(res.policy);
      setMessage({ tone: "ok", text: res.note });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "That did not save." });
      // Put the control back where it was, so the screen never shows a
      // setting that was refused.
      setSettings(config.settings);
    } finally {
      setBusy(false);
    }
  };

  const inert = agents.filter((a) => a.health.inert);
  const enabledButInert = inert.filter((a) => a.isEnabled);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Autopilot</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          What agents are allowed to do on their own, and what they must ask about first. Every
          limit here is enforced by one evaluator, so the preview below and a real run cannot
          disagree.
        </p>
      </div>

      {!config.aiConfigured ? (
        <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5 text-xs text-warning-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>No model provider is connected, so no agent runs.</strong> An agent needs a
          model to decide what to do; without one there is nothing to guard. Everything on this
          screen is real and enforced — the limits, the tool grants, the approval queue and the
          preview all work against your data. Connect a provider in Settings → AI Assistant to
          let agents act.
        </div>
      ) : null}

      {enabledButInert.length > 0 ? (
        <div className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-xs text-danger-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>
            {enabledButInert.length === 1
              ? "One agent is switched on but cannot do anything"
              : `${enabledButInert.length} agents are switched on but cannot do anything`}
          </strong>{" "}
          — every tool they hold is either undefined in this app or declared and not built yet.
          They are listed below with which tool is which.
        </div>
      ) : null}

      {/* Mode */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Mode</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {config.configured
                ? "Saved for this workspace."
                : "Nothing has been configured yet — these are the defaults, not choices you made."}
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => {
              const active = settings.mode === m.key;
              const blocked = m.key === "FULL_AUTO" && !config.aiConfigured;
              return (
                <button
                  key={m.key}
                  type="button"
                  disabled={busy || blocked}
                  onClick={() => void save({ ...settings, mode: m.key })}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left transition-colors duration-150",
                    active
                      ? "border-accent bg-accent-subtle"
                      : "border-border bg-surface hover:bg-surface-hover",
                    blocked && "cursor-not-allowed opacity-50"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <m.icon className="size-3.5 text-secondary" />
                    <span className="text-xs font-semibold text-primary">{m.label}</span>
                    {active ? <Check className="size-3 text-success-text" /> : null}
                  </div>
                  <p className="mt-1 text-2xs leading-relaxed text-secondary">{m.blurb}</p>
                  {blocked ? (
                    <p className="mt-1 text-2xs text-warning-text">
                      Needs a model provider — nothing would act.
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>

          {message ? (
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
          ) : null}
        </CardContent>
      </Card>

      {/* What this permits, in words */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>What this permits</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              Generated from the same settings the evaluator reads, so it cannot describe a
              policy that is not enforced.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1">
            {policy.map((line, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-secondary">
                <Shield className="mt-0.5 size-3 shrink-0 text-muted" />
                {line}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {settings.mode !== "OFF" ? (
        <Limits settings={settings} busy={busy} onSave={save} />
      ) : null}

      {pending.length > 0 ? <PendingQueue pending={pending} /> : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Agents</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              Each one can only call the tools listed against it.
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {agents.map((a) => (
            <AgentRow key={a.id} agent={a} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Limits({
  settings,
  busy,
  onSave,
}: {
  settings: Settings;
  busy: boolean;
  onSave: (next: Settings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const num = (key: keyof Settings, label: string, hint?: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        type="number"
        value={String(draft[key] as number)}
        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
        className="text-xs"
      />
      {hint ? <p className="text-2xs text-muted">{hint}</p> : null}
    </div>
  );

  const toggleIn = (key: "allowedTiers" | "allowedChannels", value: string) => {
    const list = draft[key];
    setDraft({
      ...draft,
      [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Limits</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            A cap that is reached makes an agent wait, not fail.
          </p>
        </div>
        {dirty ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void onSave(draft)}>
              <Check />
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(settings)}>
              Discard
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">
            Who agents may touch
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {["A", "B", "C", "D"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleIn("allowedTiers", t)}
                className={cn(
                  "rounded-md px-2 py-1 text-2xs transition-colors duration-150",
                  draft.allowedTiers.includes(t)
                    ? "bg-accent-subtle font-medium text-accent-text"
                    : "bg-surface-sunken text-muted hover:bg-surface-hover"
                )}
              >
                Tier {t}
              </button>
            ))}
            <div className="ml-2 flex items-center gap-1.5">
              <Label htmlFor="minScore" className="text-2xs">
                scoring at least
              </Label>
              <Input
                id="minScore"
                type="number"
                value={String(draft.minScore)}
                onChange={(e) => setDraft({ ...draft, minScore: Number(e.target.value) })}
                className="w-16 text-xs"
              />
            </div>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">
            Channels agents may use
          </p>
          <div className="flex flex-wrap gap-1.5">
            {["EMAIL", "WHATSAPP", "LINKEDIN", "PHONE"].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleIn("allowedChannels", c)}
                className={cn(
                  "rounded-md px-2 py-1 text-2xs transition-colors duration-150",
                  draft.allowedChannels.includes(c)
                    ? "bg-accent-subtle font-medium text-accent-text"
                    : "bg-surface-sunken text-muted hover:bg-surface-hover"
                )}
              >
                {c.toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {num("maxPointsPerDay", "Points a day", "Across every agent")}
          {num("maxEmailsPerDay", "Emails a day")}
          {num("maxWhatsappPerDay", "WhatsApp a day")}
          {num("maxLinkedinPerDay", "LinkedIn a day")}
          {num("maxLeadsPerDay", "New leads a day")}
          {num("maxRevealsPerDay", "Contact reveals a day")}
        </div>

        <div>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">
            When agents may send
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              value={String(draft.sendWindowStart)}
              onChange={(e) => setDraft({ ...draft, sendWindowStart: Number(e.target.value) })}
              className="w-16 text-xs"
              aria-label="Send window start hour"
            />
            <span className="text-2xs text-muted">to</span>
            <Input
              type="number"
              value={String(draft.sendWindowEnd)}
              onChange={(e) => setDraft({ ...draft, sendWindowEnd: Number(e.target.value) })}
              className="w-16 text-xs"
              aria-label="Send window end hour"
            />
            <div className="flex flex-wrap gap-1">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      sendDays: draft.sendDays.includes(d)
                        ? draft.sendDays.filter((x) => x !== d)
                        : [...draft.sendDays, d].sort((a, b) => a - b),
                    })
                  }
                  className={cn(
                    "rounded px-1.5 py-1 text-2xs transition-colors duration-150",
                    draft.sendDays.includes(d)
                      ? "bg-accent-subtle font-medium text-accent-text"
                      : "bg-surface-sunken text-muted hover:bg-surface-hover"
                  )}
                >
                  {DAY_NAME[d].slice(0, 1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="text-xs font-medium text-primary">
                Approve anything that costs points
              </span>
              <span className="mt-0.5 block text-2xs text-muted">
                Applies even in full-auto. Spending is the one thing that cannot be undone by
                editing a record.
              </span>
            </span>
            <Switch
              checked={draft.requireApprovalForSpend}
              onCheckedChange={(v) => setDraft({ ...draft, requireApprovalForSpend: v })}
            />
          </label>
          <div className="flex flex-col gap-1">
            <Label htmlFor="threshold">Approve anything touching at least (₹)</Label>
            <Input
              id="threshold"
              type="number"
              value={String(draft.approvalThresholdInr)}
              onChange={(e) =>
                setDraft({ ...draft, approvalThresholdInr: Number(e.target.value) })
              }
              className="text-xs"
            />
            <p className="text-2xs text-muted">Zero means no money threshold.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PendingQueue({ pending }: { pending: PendingAction[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusy(id);
    setError(null);
    setOutcome(null);
    try {
      const res = await api.post<{ note: string; ran?: boolean }>(
        `/api/agent-actions/${id}/decide`,
        { decision, reason: decision === "reject" ? reason : undefined }
      );
      setRejecting(null);
      setReason("");
      // Approving can succeed or be blocked at run time, so the result is
      // shown rather than assumed.
      setOutcome({ tone: res.ran === false ? "bad" : "ok", text: res.note });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Waiting for you</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            Work an agent has done and held. Approving re-checks the guardrails at the moment it
            runs.
          </p>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error ? (
          <p className="rounded-md border border-danger-border bg-danger-subtle px-2.5 py-2 text-2xs text-danger-text">
            {error}
          </p>
        ) : null}
        {outcome ? (
          <p
            className={cn(
              "rounded-md px-2.5 py-2 text-2xs",
              outcome.tone === "ok"
                ? "border border-success-border bg-success-subtle text-success-text"
                : "border border-warning-border bg-warning-surface text-warning-text"
            )}
          >
            {outcome.text}
          </p>
        ) : null}
        {pending.map((p) => (
          <div key={p.id} className="rounded-md border border-border-subtle bg-surface-sunken p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={p.riskClass === "SPEND" ? "warning" : "neutral"} size="sm">
                {p.riskClass}
              </Badge>
              <span className="text-xs font-medium text-primary">{p.summary}</span>
              {p.pointsSpent > 0 ? (
                <span className="text-2xs text-warning-text">{p.pointsSpent} points</span>
              ) : null}
            </div>
            <p className="mt-0.5 text-2xs text-muted">
              {p.agent.name} · {p.tool} · triggered by {p.trigger}
            </p>
            {!p.executable ? (
              <p className="mt-1 text-2xs text-danger-text">
                <AlertTriangle className="mr-0.5 inline size-2.5" />
                Approving this would do nothing — {p.tool} is not built yet.
              </p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {rejecting === p.id ? (
                <>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why are you overruling the agent?"
                    className="max-w-sm text-xs"
                  />
                  <Button
                    size="xs"
                    variant="danger"
                    disabled={busy === p.id || reason.trim().length < 3}
                    onClick={() => void decide(p.id, "reject")}
                  >
                    Confirm
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setRejecting(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Tooltip
                    content={
                      p.executable
                        ? "Approving runs it now. The guardrails are checked again at that moment, so a lead suppressed since this was held is still refused."
                        : "This tool is not built, so approving it cannot take effect."
                    }
                  >
                    <Button
                      size="xs"
                      variant="primary"
                      disabled={busy === p.id || !p.executable}
                      onClick={() => void decide(p.id, "approve")}
                    >
                      <Check />
                      Approve and run
                    </Button>
                  </Tooltip>
                  <Button size="xs" variant="secondary" onClick={() => setRejecting(p.id)}>
                    <X />
                    Overrule
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [running, setRunning] = useState(false);

  const toggle = async (isEnabled: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.post<{ note: string }>(`/api/agents/${agent.id}/enable`, { isEnabled });
      setMessage({ tone: "ok", text: res.note });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "That did not work." });
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    setRunning(true);
    setMessage(null);
    try {
      setDryRun(await api.post<DryRun>(`/api/agents/${agent.id}/dry-run`, {}));
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "Preview failed." });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-md border p-3",
        agent.health.inert && agent.isEnabled
          ? "border-danger-border bg-danger-subtle/30"
          : "border-border-subtle bg-surface-sunken"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-primary">{agent.name}</span>
            {agent.health.inert ? (
              <Tooltip content="Every tool this agent holds is either undefined in this app or declared and not built. It would do nothing.">
                <span className="cursor-help">
                  <Badge variant="danger" size="sm">
                    Inert
                  </Badge>
                </span>
              </Tooltip>
            ) : null}
            {agent.approvalPolicy === "review_first" ? (
              <Tooltip content="This agent asks for approval regardless of the workspace mode.">
                <span className="cursor-help">
                  <Badge variant="neutral" size="sm">
                    Always asks
                  </Badge>
                </span>
              </Tooltip>
            ) : null}
          </p>
          <p className="mt-0.5 text-2xs text-secondary">{agent.goal}</p>
          {agent.blockedBecause ? (
            <p className="mt-0.5 text-2xs text-muted">
              <Info className="mr-0.5 inline size-2.5" />
              {agent.blockedBecause}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {agent.dailyPointBudget > 0 ? (
            <Tooltip content={`${agent.usedToday.points} of ${agent.dailyPointBudget} points used today`}>
              <span className="cursor-help text-2xs tabular text-muted">
                <Gauge className="mr-0.5 inline size-2.5" />
                {agent.usedToday.points}/{agent.dailyPointBudget}
              </span>
            </Tooltip>
          ) : null}
          <Switch
            checked={agent.isEnabled}
            disabled={busy}
            onCheckedChange={(v) => void toggle(v)}
            aria-label={`${agent.isEnabled ? "Disable" : "Enable"} ${agent.name}`}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {agent.tools.map((t) => (
          <Tooltip
            key={t.name}
            content={
              !t.known
                ? "Not a tool this app defines. Nothing can run it."
                : !t.implemented
                  ? "Declared but not built yet."
                  : "Available."
            }
          >
            <span
              className={cn(
                "cursor-help rounded px-1.5 py-0.5 font-mono text-2xs",
                !t.known
                  ? "bg-danger-subtle text-danger-text line-through"
                  : !t.implemented
                    ? "bg-warning-surface text-warning-text"
                    : "bg-success-subtle text-success-text"
              )}
            >
              {t.name}
            </span>
          </Tooltip>
        ))}
      </div>

      {message ? (
        <p
          className={cn(
            "mt-2 rounded-md px-2 py-1.5 text-2xs",
            message.tone === "ok"
              ? "border border-info-border bg-info-subtle text-info-text"
              : "border border-danger-border bg-danger-subtle text-danger-text"
          )}
        >
          {message.text}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="secondary" loading={running} onClick={() => void preview()}>
          {!running && <Play />}
          Preview against my leads
        </Button>
        {agent.runCount > 0 ? (
          <span className="text-2xs text-muted">{formatNumber(agent.runCount)} runs recorded</span>
        ) : (
          <span className="text-2xs text-muted">never run</span>
        )}
      </div>

      {dryRun ? <DryRunPanel dryRun={dryRun} /> : null}
    </div>
  );
}

/**
 * The dry run.
 *
 * The honest substitute for "watch the agent work": real leads, the real
 * evaluator, no writes and no model call. Because the same function decides
 * here and at execution time, this is a prediction the system is bound by.
 */
function DryRunPanel({ dryRun }: { dryRun: DryRun }) {
  return (
    <div className="mt-2 rounded-md border border-border bg-surface p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
          What would happen to {dryRun.examined} {dryRun.examined === 1 ? "lead" : "leads"}
        </p>
        {dryRun.consideredAction ? (
          <Tooltip content="The most consequential tool this agent holds, so the preview shows the hardest case rather than the easiest.">
            <span className="cursor-help font-mono text-2xs text-muted">
              {dryRun.consideredAction.tool} · {dryRun.consideredAction.riskClass}
            </span>
          </Tooltip>
        ) : null}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {Object.entries(dryRun.tally).map(([disposition, count]) => {
          const meta = DISPOSITION_META[disposition];
          return (
            <Tooltip key={disposition} content={meta?.meaning ?? disposition}>
              <span className="cursor-help">
                <Badge variant={meta?.variant ?? "neutral"} size="sm">
                  {count} {meta?.label ?? disposition}
                </Badge>
              </span>
            </Tooltip>
          );
        })}
      </div>

      <ul className="mt-2 flex flex-col gap-1">
        {dryRun.rows.slice(0, 6).map((r) => {
          const meta = DISPOSITION_META[r.disposition];
          return (
            <li key={r.leadId} className="flex flex-wrap items-baseline gap-1.5 text-2xs">
              <Badge variant={meta?.variant ?? "neutral"} size="sm">
                {meta?.label ?? r.disposition}
              </Badge>
              <span className="text-primary">{r.name}</span>
              <span className="text-muted">
                {r.company} · tier {r.tier}
                {r.score !== null ? ` · ${r.score}` : ""}
              </span>
              <span className="text-secondary">— {r.headline}</span>
            </li>
          );
        })}
      </ul>
      {dryRun.rows.length > 6 ? (
        <p className="mt-1 text-2xs text-muted">and {dryRun.rows.length - 6} more</p>
      ) : null}

      <p className="mt-2 flex gap-1 text-2xs text-muted">
        <Sparkles className="mt-0.5 size-2.5 shrink-0" />
        {dryRun.note}
      </p>
    </div>
  );
}
