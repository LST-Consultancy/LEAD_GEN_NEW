"use client";

import {
  AlertTriangle,
  Ban,
  Check,
  Coins,
  Info,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatAge, formatInr, formatNumber } from "@/lib/format";

type Trust = {
  mode: string;
  policy: string[];
  aiConfigured: boolean;
  services: { name: string; connected: boolean; detail: string; grants: string }[];
  limits: {
    pointsPerDay: number;
    pointsUsedToday: number;
    emailsPerDay: number;
    whatsappPerDay: number;
    linkedinPerDay: number;
    revealsPerDay: number;
    requireApprovalForSpend: boolean;
    approvalThresholdInr: number;
  };
  reach: {
    agentsEnabled: number;
    agentsTotal: number;
    toolsGranted: number;
    toolsReachable: number;
    reachableNames: string[];
    alwaysAsks: string[];
  };
  today: { riskClass: string; state: string; count: number; points: number }[];
  recent: {
    id: string;
    tool: string;
    riskClass: string;
    summary: string;
    state: string;
    pointsSpent: number;
    agent: string;
    occurredAt: string;
    executable: boolean;
  }[];
  you: {
    role: string;
    canApprove: boolean;
    canConfigure: boolean;
    permissionCount: number;
    ofPossible: number;
  };
  roleCatalogue: { key: string; name: string; canApprove: boolean; canConfigure: boolean }[];
};

const MODE_META: Record<string, { label: string; icon: typeof Shield; tone: string; blurb: string }> = {
  OFF: {
    label: "Off",
    icon: Ban,
    tone: "text-secondary",
    blurb: "Agents may read to answer questions. They cannot change or send anything.",
  },
  REVIEW_FIRST: {
    label: "Review first",
    icon: ShieldCheck,
    tone: "text-success-text",
    blurb: "Nothing takes effect until a person approves it.",
  },
  FULL_AUTO: {
    label: "Full auto",
    icon: ShieldAlert,
    tone: "text-warning-text",
    blurb: "Agents act without asking, within the limits below.",
  },
};

export function TrustView({ trust }: { trust: Trust }) {
  const mode = MODE_META[trust.mode] ?? MODE_META.OFF;
  const connected = trust.services.filter((s) => s.connected);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Trust Center</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Exactly what automation is allowed to do here, what it can actually reach, and what it
          has done. Assembled from the same settings and checks the enforcing code reads — not a
          separate description that could drift from the rules themselves.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <mode.icon className={cn("size-4", mode.tone)} />
            <span className="text-sm font-semibold text-primary">Autopilot is {mode.label.toLowerCase()}</span>
            <Link href="/autopilot" className="text-2xs text-accent-text hover:underline">
              change
            </Link>
          </div>
          <p className="text-xs text-secondary">{mode.blurb}</p>
          {!trust.aiConfigured ? (
            <p className="rounded-md border border-warning-border bg-warning-surface px-2.5 py-2 text-2xs text-warning-text">
              <AlertTriangle className="mr-1 inline size-3" />
              No model provider is connected, so regardless of the mode above, no agent can decide
              anything and none of them run.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* What automation can actually reach */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>What automation can reach</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              Permission granted is not the same as capability. Both are shown.
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md bg-surface-sunken px-2.5 py-2">
              <p className="text-2xs uppercase tracking-wider text-muted">Agents enabled</p>
              <p className="text-base font-semibold tabular text-primary">
                {trust.reach.agentsEnabled}
                <span className="text-xs font-normal text-muted"> of {trust.reach.agentsTotal}</span>
              </p>
            </div>
            <div className="rounded-md bg-surface-sunken px-2.5 py-2">
              <p className="text-2xs uppercase tracking-wider text-muted">Tools granted</p>
              <p className="text-base font-semibold tabular text-primary">
                {trust.reach.toolsGranted}
              </p>
            </div>
            <Tooltip content="A granted tool that is not built cannot be used by anyone. This is the honest number.">
              <div className="cursor-help rounded-md bg-surface-sunken px-2.5 py-2">
                <p className="text-2xs uppercase tracking-wider text-muted">Actually usable</p>
                <p
                  className={cn(
                    "text-base font-semibold tabular",
                    trust.reach.toolsReachable < trust.reach.toolsGranted
                      ? "text-warning-text"
                      : "text-primary"
                  )}
                >
                  {trust.reach.toolsReachable}
                </p>
              </div>
            </Tooltip>
          </div>

          {trust.reach.reachableNames.length > 0 ? (
            <div>
              <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">
                Automation can call these, and nothing else
              </p>
              <div className="flex flex-wrap gap-1">
                {trust.reach.reachableNames.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-success-subtle px-1.5 py-0.5 font-mono text-2xs text-success-text"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-2xs text-secondary">
              <Wrench className="mr-0.5 inline size-2.5" />
              Nothing. No enabled agent holds a tool that is built, so automation cannot change
              anything here at all.
            </p>
          )}

          {trust.reach.alwaysAsks.length > 0 ? (
            <p className="text-2xs text-muted">
              Always asks regardless of the mode: {trust.reach.alwaysAsks.join(", ")}.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Connected services */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Connected services</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {connected.length} of {trust.services.length} connected. Each says what it would be
              allowed to do.
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {trust.services.map((s) => (
            <div
              key={s.name}
              className="rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {s.connected ? (
                  <Check className="size-3 text-success-text" />
                ) : (
                  <X className="size-3 text-muted" />
                )}
                <span className="text-xs font-medium text-primary">{s.name}</span>
                <Badge variant={s.connected ? "success" : "neutral"} size="sm">
                  {s.connected ? "Connected" : "Not connected"}
                </Badge>
              </div>
              <p className="mt-0.5 text-2xs text-secondary">{s.detail}</p>
              <p className="text-2xs text-muted">
                <strong>Would be allowed to:</strong> {s.grants}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Limits */}
      <Card>
        <CardHeader>
          <CardTitle>Daily limits</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-2xs uppercase tracking-wider text-muted">
                <Coins className="mr-0.5 inline size-2.5" />
                Points spent by automation today
              </span>
              <span className="text-2xs tabular text-secondary">
                {trust.limits.pointsUsedToday} of {trust.limits.pointsPerDay}
              </span>
            </div>
            <Progress
              value={
                trust.limits.pointsPerDay > 0
                  ? Math.min(100, (trust.limits.pointsUsedToday / trust.limits.pointsPerDay) * 100)
                  : 0
              }
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Limit label="Emails" value={trust.limits.emailsPerDay} />
            <Limit label="WhatsApp" value={trust.limits.whatsappPerDay} />
            <Limit label="LinkedIn" value={trust.limits.linkedinPerDay} />
            <Limit label="Contact reveals" value={trust.limits.revealsPerDay} />
          </div>

          <ul className="flex flex-col gap-1 border-t border-border-subtle pt-2">
            <li className="flex gap-1.5 text-2xs text-secondary">
              {trust.limits.requireApprovalForSpend ? (
                <ShieldCheck className="mt-0.5 size-3 shrink-0 text-success-text" />
              ) : (
                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning-text" />
              )}
              {trust.limits.requireApprovalForSpend
                ? "Anything that costs points needs a person's approval, even in full-auto."
                : "Spending does not need approval in full-auto. Points can leave the account without anyone confirming."}
            </li>
            {trust.limits.approvalThresholdInr > 0 ? (
              <li className="flex gap-1.5 text-2xs text-secondary">
                <Shield className="mt-0.5 size-3 shrink-0 text-muted" />
                Anything touching {formatInr(trust.limits.approvalThresholdInr)} or more needs
                approval.
              </li>
            ) : null}
          </ul>
        </CardContent>
      </Card>

      {/* The policy in words */}
      <Card>
        <CardHeader>
          <CardTitle>The policy, in words</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1">
            {trust.policy.map((line, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-secondary">
                <Shield className="mt-0.5 size-3 shrink-0 text-muted" />
                {line}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* You */}
      <Card>
        <CardHeader>
          <CardTitle>What you can do about it</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-secondary">
            You are <strong className="text-primary">{trust.you.role}</strong>, holding{" "}
            {trust.you.permissionCount} of {trust.you.ofPossible} permissions.
          </p>
          <ul className="flex flex-col gap-1">
            <li className="flex items-center gap-1.5 text-2xs text-secondary">
              {trust.you.canApprove ? (
                <Check className="size-3 text-success-text" />
              ) : (
                <X className="size-3 text-muted" />
              )}
              {trust.you.canApprove
                ? "You can approve or overrule automated actions."
                : "You cannot approve automated actions."}
            </li>
            <li className="flex items-center gap-1.5 text-2xs text-secondary">
              {trust.you.canConfigure ? (
                <Check className="size-3 text-success-text" />
              ) : (
                <X className="size-3 text-muted" />
              )}
              {trust.you.canConfigure
                ? "You can change these limits."
                : "You cannot change these limits."}
            </li>
          </ul>
          <div className="mt-1 border-t border-border-subtle pt-2">
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">
              Which roles can
            </p>
            <div className="flex flex-wrap gap-1.5">
              {trust.roleCatalogue.map((r) => (
                <Tooltip
                  key={r.key}
                  content={`${r.canApprove ? "Can approve" : "Cannot approve"}; ${r.canConfigure ? "can change limits" : "cannot change limits"}`}
                >
                  <span
                    className={cn(
                      "cursor-help rounded-md px-2 py-1 text-2xs",
                      r.canApprove
                        ? "bg-success-subtle text-success-text"
                        : "bg-surface-sunken text-muted"
                    )}
                  >
                    {r.name}
                  </span>
                </Tooltip>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent actions */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>What automation has done</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              The last {trust.recent.length}. Refusals are kept too — &ldquo;did nothing&rdquo;
              and &ldquo;was stopped&rdquo; are different facts.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {trust.recent.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted">
              Nothing recorded. No agent has run here.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {trust.recent.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-1.5 px-4 py-2">
                  <Badge
                    variant={
                      a.state === "completed" || a.state === "executed"
                        ? "success"
                        : a.state === "refused"
                          ? "danger"
                          : a.state === "deferred"
                            ? "neutral"
                            : "warning"
                    }
                    size="sm"
                  >
                    {a.state.replace(/_/g, " ")}
                  </Badge>
                  <span className="text-xs text-primary">{a.summary}</span>
                  <span className="text-2xs text-muted">
                    {a.agent} · {a.tool} · {formatAge(a.occurredAt)}
                  </span>
                  {a.pointsSpent > 0 ? (
                    <span className="text-2xs text-warning-text">{a.pointsSpent} points</span>
                  ) : null}
                  {!a.executable ? (
                    <Tooltip content="This tool is not built, so nothing could have happened regardless of the state above.">
                      <span className="cursor-help text-2xs text-muted">
                        <Info className="inline size-2.5" /> unbuilt tool
                      </span>
                    </Tooltip>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Limit({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-surface-sunken px-2.5 py-1.5">
      <p className="text-2xs uppercase tracking-wider text-muted">{label}</p>
      <p className="text-sm font-semibold tabular text-primary">
        {formatNumber(value)}
        <span className="text-2xs font-normal text-muted"> /day</span>
      </p>
    </div>
  );
}
