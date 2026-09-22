"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUp, Ban, Bot, Info, Sparkles, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { ErrorState } from "@/components/ui/states";
import { RISK_CLASS } from "@/lib/vocab";
import { formatInr } from "@/lib/format";
import { cn } from "@/lib/utils";

type Evidence = { label: string; detail?: string; href?: string };

export type ToolCard = {
  name: string;
  riskClass: string;
  description: string;
  implemented: boolean;
};

type Answer = {
  text: string;
  evidence?: Evidence[];
  grounding?: { name: string; riskClass: string }[];
  model?: string | null;
  direct?: boolean;
  unavailable?: boolean;
  costInr?: number;
};

type Turn =
  | { id: string; role: "user"; text: string }
  | ({ id: string; role: "assistant" } & Answer);

const SUGGESTIONS = [
  "What should I do today?",
  "Which deals are stalled?",
  "Where should I focus my effort tomorrow morning and why?",
  "How much pipeline is at risk?",
  "Who replied recently?",
];

/**
 * The full-screen Copilot.
 *
 * The drawer answers a question while you are on another screen. This screen
 * exists to show *how* the answer was reached — which tools were read, whether
 * a model was involved at all, and what the call cost. A grounded answer whose
 * grounding you cannot inspect is just a confident sentence.
 */
export function CopilotConsole({ tools }: { tools: ToolCard[] }) {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    setTurns((t) => [...t, { id: crypto.randomUUID(), role: "user", text: q }]);

    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as Answer;
      setTurns((t) => [...t, { id: crypto.randomUUID(), role: "assistant", ...data }]);
    } catch {
      setError("Copilot couldn't reach the workspace. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  // Grouped by what the Copilot does with each, not by risk class. A built
  // write tool is real, but it belongs to an agent — listing it as something
  // the Copilot can do would be the same lie as listing an unbuilt one.
  const readable = tools.filter((t) => t.implemented && t.riskClass === "READ");
  const agentOnly = tools.filter((t) => t.implemented && t.riskClass !== "READ");
  const unbuilt = tools.filter((t) => !t.implemented);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Copilot</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Every answer is read from this workspace through the tools listed alongside. Where a
          question needs a tool that isn&apos;t built, the Copilot names it and stops rather than
          answering anyway.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="flex min-h-[520px] flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            {turns.length === 0 ? (
              <EmptyPrompt onPick={(s) => void ask(s)} />
            ) : (
              <ol className="space-y-5">
                {turns.map((turn) =>
                  turn.role === "user" ? (
                    <li key={turn.id} className="flex justify-end">
                      <div className="max-w-[80%] rounded-lg rounded-br-sm bg-brand px-3 py-2 text-xs text-brand-fg">
                        {turn.text}
                      </div>
                    </li>
                  ) : (
                    <li key={turn.id} className="space-y-2">
                      <div
                        className={cn(
                          "rounded-lg border px-3 py-2.5 text-xs leading-relaxed",
                          turn.unavailable
                            ? "border-warning-border bg-warning-subtle text-warning-text"
                            : "border-border bg-surface text-secondary"
                        )}
                      >
                        {turn.unavailable ? (
                          <span className="flex gap-2">
                            <Info className="mt-0.5 size-3.5 shrink-0" />
                            <span className="whitespace-pre-wrap">{turn.text}</span>
                          </span>
                        ) : (
                          <span className="whitespace-pre-wrap">{turn.text}</span>
                        )}
                      </div>

                      {turn.evidence?.length ? (
                        <ul className="space-y-1 px-1">
                          {turn.evidence.map((e, i) => (
                            <li key={i} className="text-2xs">
                              {e.href ? (
                                <Link
                                  href={e.href}
                                  className="text-brand-text underline-offset-2 hover:underline"
                                >
                                  {e.label}
                                </Link>
                              ) : (
                                <span className="text-secondary">{e.label}</span>
                              )}
                              {e.detail ? <span className="text-muted"> — {e.detail}</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      <Provenance turn={turn} />
                    </li>
                  )
                )}
                {busy ? (
                  <li className="flex items-center gap-2 px-1 text-xs text-muted">
                    <span className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="size-1 animate-pulse rounded-full bg-ai-accent"
                          style={{ animationDelay: `${i * 140}ms` }}
                        />
                      ))}
                    </span>
                    Reading your workspace…
                  </li>
                ) : null}
              </ol>
            )}

            {error ? <ErrorState compact title="Copilot unavailable" description={error} /> : null}
          </div>

          <div className="space-y-2 border-t border-border p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ask(input);
              }}
              className="relative"
            >
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(input);
                  }
                }}
                placeholder="Ask about leads, pipeline, replies, revenue…"
                rows={2}
                className="resize-none pr-11 text-xs"
                aria-label="Ask Copilot"
              />
              <Button
                type="submit"
                size="icon-sm"
                variant="primary"
                className="absolute bottom-2 right-2"
                disabled={!input.trim() || busy}
                aria-label="Send"
              >
                <ArrowUp />
              </Button>
            </form>
            <p className="text-2xs text-muted">
              <Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> newline. The Copilot only reads — nothing here sends
              a message, spends a point or changes a record.
            </p>
          </div>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <Wrench className="size-3.5 text-muted" />
                What it can read
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-0">
              {readable.map((t) => (
                <ToolRow key={t.name} tool={t} />
              ))}
            </CardContent>
          </Card>

          {agentOnly.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Bot className="size-3.5 text-muted" />
                  Built, but agents only
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                <p className="text-2xs leading-relaxed text-muted">
                  These work — but they change something, so they run from an{" "}
                  <Link href="/ai-agents" className="text-brand-text underline-offset-2 hover:underline">
                    agent
                  </Link>{" "}
                  where a budget, the guardrails and the approval queue apply. Ask for one here and
                  the Copilot will say so.
                </p>
                {agentOnly.map((t) => (
                  <ToolRow key={t.name} tool={t} />
                ))}
              </CardContent>
            </Card>
          ) : null}

          {unbuilt.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Ban className="size-3.5 text-muted" />
                  Not built yet
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                <p className="text-2xs text-muted">
                  Ask for one of these and the Copilot will name it and stop.
                </p>
                {unbuilt.map((t) => (
                  <ToolRow key={t.name} tool={t} />
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolCard }) {
  const risk = RISK_CLASS[tool.riskClass];
  return (
    <div className={cn("space-y-0.5", !tool.implemented && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-2xs text-primary">{tool.name}</span>
        <Badge size="sm" variant={risk?.variant ?? "neutral"}>
          {risk?.label ?? tool.riskClass}
        </Badge>
      </div>
      <p className="text-2xs leading-relaxed text-muted">{tool.description}</p>
    </div>
  );
}

/**
 * Says how the answer was reached.
 *
 * A routed answer is the tool's own sentence and involved no model at all,
 * which is the more trustworthy of the two paths — so it is labelled as such
 * rather than left looking like a model reply.
 */
function Provenance({ turn }: { turn: Answer }) {
  const grounding = turn.grounding ?? [];
  if (turn.unavailable || grounding.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-2xs text-muted">
      {turn.direct ? (
        <Tooltip content="One tool answered this question completely. No model was called, so nothing was rephrased.">
          <span className="cursor-help">
            <Badge variant="success" size="sm">
              Read directly
            </Badge>
          </span>
        </Tooltip>
      ) : (
        <Tooltip content="No single tool answered it, so every readable tool was run and the model phrased an answer from those results alone.">
          <span className="cursor-help">
            <Badge variant="ai" size="sm">
              <Sparkles className="size-2.5" />
              Phrased by {turn.model ?? "the model"}
            </Badge>
          </span>
        </Tooltip>
      )}
      <span>
        from{" "}
        {grounding.map((g, i) => (
          <React.Fragment key={g.name}>
            {i > 0 ? ", " : ""}
            <span className="font-mono text-primary">{g.name}</span>
          </React.Fragment>
        ))}
      </span>
      {typeof turn.costInr === "number" && turn.costInr > 0 ? (
        <Tooltip content="Estimated from published per-token list prices, not read from a billing API.">
          <span className="cursor-help tabular-nums">
            · ~{formatInr(turn.costInr, { paise: true })}
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

function EmptyPrompt({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-10">
      <div className="rounded-lg border border-ai-border bg-ai-surface p-3">
        <p className="text-xs leading-relaxed text-secondary">
          Ask a question about this workspace. Short, specific ones are answered by a single tool
          with no model involved at all. Open-ended ones read every tool first and a model phrases
          the result — it is never allowed to add a figure that wasn&apos;t read.
        </p>
      </div>
      <div>
        <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted">Try</p>
        <div className="space-y-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left text-xs text-secondary transition-colors hover:border-brand-border hover:bg-brand-subtle hover:text-primary"
            >
              {s}
              <ArrowUp className="size-3 shrink-0 rotate-45 text-muted" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
