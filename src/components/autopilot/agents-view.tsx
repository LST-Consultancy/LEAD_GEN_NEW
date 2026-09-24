"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Coins,
  Gauge,
  Info,
  Play,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { ApiError, api } from "@/lib/api/client";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { formatAge, formatNumber } from "@/lib/format";

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

type Detail = {
  runs: {
    id: string;
    trigger: string;
    state: string;
    summary: string | null;
    pointsSpent: number;
    actionsTaken: number;
    actionsHeld: number;
    startedAt: string;
    errorMessage: string | null;
    actions: {
      id: string;
      sequence: number;
      tool: string;
      riskClass: string;
      summary: string;
      state: string;
      pointsSpent: number;
      executable: boolean;
    }[];
  }[];
};

/** Each agent's remit, in the product's own words rather than the enum's. */
const REMIT: Record<string, string> = {
  PROSPECTING: "Finds leads that match your ICP and surfaces them with a reason.",
  RESEARCH: "Builds an account dossier before anyone makes contact.",
  SDR: "Drafts first-touch outreach grounded in the actual signal.",
  FOLLOW_UP: "Notices threads that went quiet and proposes the next touch.",
  PIPELINE: "Watches deals for stalls and missing next steps.",
  PROPOSAL: "Assembles a proposal from what the deal already knows.",
  MEETING: "Prepares the pre-call brief and captures what came out of it.",
  REVENUE_ANALYST: "Answers questions about the numbers from real queries.",
};

export function AgentsView({ agents, aiConfigured, canConfigure = false }: { agents: Agent[]; aiConfigured: boolean; canConfigure?: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const inert = agents.filter((a) => a.health.inert);
  const enabledInert = inert.filter((a) => a.isEnabled);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">AI Agents</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          {agents.length ? `${agents.length} specialised ${agents.length === 1 ? "agent" : "agents"}` : "Specialised agents"}, each with its own remit, its own tools, its own budget and its
          own approval policy. An agent can only call the tools listed against it — never anything
          else.
        </p>
      </div>

      {!aiConfigured ? (
        <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5 text-xs text-warning-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>No model provider is connected.</strong> An agent needs a model to decide what
          to do, so none of these run yet. Their tools, budgets and policies are real and
          enforced — see the{" "}
          <Link href="/autopilot" className="underline">
            preview on Autopilot
          </Link>{" "}
          for what each would do against your leads.
        </div>
      ) : null}

      {enabledInert.length > 0 ? (
        <div className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-xs text-danger-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>
            {enabledInert.length === 1
              ? "One enabled agent holds no usable tool"
              : `${enabledInert.length} enabled agents hold no usable tool`}
          </strong>{" "}
          — struck-through names below are not tools this app defines; amber ones are declared and
          not built. Either way those agents would do nothing.
        </div>
      ) : null}

      {agents.length === 0 ? <SetUpAgents canConfigure={canConfigure} /> : null}

      <div className="flex flex-col gap-2">
        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            expanded={expanded === a.id}
            onToggle={() => setExpanded(expanded === a.id ? null : a.id)}
          />
        ))}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  expanded,
  onToggle,
}: {
  agent: Agent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);

  const open = async () => {
    onToggle();
    if (!expanded && !detail) {
      setLoading(true);
      try {
        setDetail(await api.get<Detail>(`/api/agents/${agent.id}`));
      } catch {
        setMessage({ tone: "bad", text: "Could not load this agent's history." });
      } finally {
        setLoading(false);
      }
    }
  };

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

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => void open()}
          className="flex min-w-0 items-start gap-2 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted" />
          )}
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-1.5">
              <Bot className="size-3.5 text-muted" />
              <span className="truncate">{agent.name}</span>
              {agent.health.inert ? (
                <Tooltip content="Every tool it holds is either undefined here or not built. It would do nothing.">
                  <span className="cursor-help">
                    <Badge variant="danger" size="sm">
                      Inert
                    </Badge>
                  </span>
                </Tooltip>
              ) : null}
              {agent.approvalPolicy === "review_first" ? (
                <Tooltip content="Asks for approval regardless of the workspace mode.">
                  <span className="cursor-help">
                    <Badge variant="neutral" size="sm">
                      Always asks
                    </Badge>
                  </span>
                </Tooltip>
              ) : null}
            </CardTitle>
            <p className="mt-0.5 text-2xs text-secondary">
              {REMIT[agent.kind] ?? agent.goal}
            </p>
            {agent.blockedBecause ? (
              <p className="mt-0.5 text-2xs text-muted">
                <Info className="mr-0.5 inline size-2.5" />
                {agent.blockedBecause}
              </p>
            ) : null}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          <Switch
            checked={agent.isEnabled}
            disabled={busy}
            onCheckedChange={(v) => void toggle(v)}
            aria-label={`${agent.isEnabled ? "Disable" : "Enable"} ${agent.name}`}
          />
        </div>
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

      <CardContent className="flex flex-col gap-3 pt-0">
        {/* Budget and cap */}
        <div className="grid gap-2 sm:grid-cols-2">
          <BudgetBar
            icon={Coins}
            label="Points today"
            used={agent.usedToday.points}
            limit={agent.dailyPointBudget}
            unlimitedNote="No point budget of its own — only the workspace limit applies."
          />
          <BudgetBar
            icon={Gauge}
            label="Actions today"
            used={agent.usedToday.actions}
            limit={agent.dailyActionCap}
            unlimitedNote="No action cap."
          />
        </div>

        {/* Tools */}
        <div>
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">
            <Wrench className="mr-0.5 inline size-2.5" />
            Tools it may call ({agent.health.usable} usable of {agent.tools.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {agent.tools.map((t) => (
              <Tooltip
                key={t.name}
                content={
                  !t.known
                    ? "Not a tool this app defines. Nothing can run it — remove it from the agent."
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
        </div>

        {expanded ? (
          <div className="border-t border-border-subtle pt-2">
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">
              Its own activity ({formatNumber(agent.runCount)} runs recorded)
            </p>
            {loading ? (
              <p className="text-2xs text-muted">Loading…</p>
            ) : !detail || detail.runs.length === 0 ? (
              <p className="text-2xs text-muted">
                Nothing recorded. This agent has never run.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {detail.runs.map((r) => (
                  <li key={r.id} className="rounded-md bg-surface-sunken px-2.5 py-2">
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <Badge
                        variant={r.state === "SUCCEEDED" ? "success" : "danger"}
                        size="sm"
                      >
                        {r.state.toLowerCase()}
                      </Badge>
                      <span className="text-2xs text-secondary">
                        {r.summary ?? "No summary"}
                      </span>
                      <span className="text-2xs text-muted">
                        {r.trigger} · {formatAge(r.startedAt)}
                      </span>
                      {r.actionsHeld > 0 ? (
                        <Link href="/approvals" className="text-2xs text-accent-text hover:underline">
                          {r.actionsHeld} held →
                        </Link>
                      ) : null}
                    </div>
                    {r.actions.length > 0 ? (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {r.actions.map((a) => (
                          <li key={a.id} className="flex flex-wrap items-baseline gap-1 text-2xs">
                            <span className="text-muted">{a.sequence}.</span>
                            <span
                              className={cn(
                                a.state === "completed" || a.state === "executed"
                                  ? "text-success-text"
                                  : a.state === "refused"
                                    ? "text-danger-text"
                                    : "text-muted"
                              )}
                            >
                              {a.state.replace(/_/g, " ")}
                            </span>
                            <span className="text-secondary">{a.summary}</span>
                            <span className="font-mono text-muted">{a.tool}</span>
                            {!a.executable ? (
                              <Tooltip content="Unbuilt tool — nothing could have happened.">
                                <Info className="inline size-2.5 cursor-help text-muted" />
                              </Tooltip>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2">
              <Button size="xs" variant="ghost" asChild>
                <Link href="/autopilot">
                  <Play />
                  Preview what it would do
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BudgetBar({
  icon: Icon,
  label,
  used,
  limit,
  unlimitedNote,
}: {
  icon: typeof Coins;
  label: string;
  used: number;
  limit: number;
  unlimitedNote: string;
}) {
  return (
    <div className="rounded-md bg-surface-sunken px-2.5 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-2xs uppercase tracking-wider text-muted">
          <Icon className="mr-0.5 inline size-2.5" />
          {label}
        </span>
        <span className="text-2xs tabular text-secondary">
          {limit > 0 ? `${used} of ${limit}` : `${used}`}
        </span>
      </div>
      {limit > 0 ? (
        <Progress value={Math.min(100, (used / limit) * 100)} className="mt-1" />
      ) : (
        <p className="mt-0.5 text-2xs text-muted">{unlimitedNote}</p>
      )}
    </div>
  );
}

/** No agents yet: add the catalogue, switched off, so each can be reviewed before it does anything. */
function SetUpAgents({ canConfigure }: { canConfigure: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function setUp() {
    setPending(true);
    try { const r = await api.post<{ note: string }>("/api/agents/provision", {}); setNote(r.note); router.refresh(); }
    catch (err) { setNote(err instanceof ApiError ? err.message : "Nothing was set up."); }
    finally { setPending(false); }
  }
  return (
    <Card>
      <CardContent className="p-0">
        <EmptyState
          icon={Bot}
          title="No agents set up in this workspace"
          description="Setting up adds the prospecting, research, SDR, follow-up, pipeline, proposal, meeting and revenue-analyst agents — every one switched off and set to review first. Nothing runs until you enable one."
          action={canConfigure ? <Button variant="primary" size="sm" loading={pending} onClick={() => void setUp()}>Set up agents</Button> : <p className="text-2xs text-muted">Ask someone who can configure agents to set them up.</p>}
        />
        {note ? <p className="px-4 pb-3 text-2xs text-secondary">{note}</p> : null}
      </CardContent>
    </Card>
  );
}
