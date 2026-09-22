"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUp, Info, Sparkles, Wrench } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { ErrorState } from "@/components/ui/states";
import { RISK_CLASS } from "@/lib/vocab";
import { cn } from "@/lib/utils";

type Evidence = { label: string; detail?: string; href?: string };

type CopilotTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Which tool produced this answer, so the user can see it isn't invented. */
  tool?: { name: string; riskClass: string };
  evidence?: Evidence[];
  /** True when the answer could not be produced because no model is configured. */
  unavailable?: boolean;
};

const SUGGESTIONS = [
  "What should I do today?",
  "Show my hottest leads",
  "Which deals are stalled?",
  "Who replied recently?",
  "How much pipeline is at risk?",
];

/**
 * §62 / §63 — the Copilot answers from tool calls against live workspace data.
 * Where it cannot ground an answer it says so rather than generating prose.
 */
export function CopilotDrawer({
  open,
  onOpenChange,
  seed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seed?: string;
}) {
  const [turns, setTurns] = React.useState<CopilotTurn[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open && seed) setInput(seed);
  }, [open, seed]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    const userTurn: CopilotTurn = { id: crypto.randomUUID(), role: "user", text: q };
    setTurns((t) => [...t, userTurn]);

    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as Omit<CopilotTurn, "id" | "role">;
      setTurns((t) => [...t, { id: crypto.randomUUID(), role: "assistant", ...data }]);
    } catch {
      setError("Copilot couldn't reach the workspace. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" className="sm:max-w-[420px]">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-ai-accent" />
            Copilot
            <Badge variant="ai" size="sm" uppercase>
              Grounded
            </Badge>
          </DrawerTitle>
          <p className="text-2xs text-muted">
            Answers come from your workspace data. Every claim links to its evidence.
          </p>
        </DrawerHeader>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {turns.length === 0 ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-ai-border bg-ai-surface p-3">
                <p className="text-xs leading-relaxed text-secondary">
                  Ask about your leads, pipeline, replies or forecast. I run real queries against this
                  workspace — I don&apos;t guess.
                </p>
              </div>
              <div>
                <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted">Try</p>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void ask(s)}
                      className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left text-xs text-secondary transition-colors hover:border-brand-border hover:bg-brand-subtle hover:text-primary"
                    >
                      {s}
                      <ArrowUp className="size-3 shrink-0 rotate-45 text-muted" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <ol className="space-y-4">
              {turns.map((turn) =>
                turn.role === "user" ? (
                  <li key={turn.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg rounded-br-sm bg-brand px-2.5 py-1.5 text-xs text-brand-fg">
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

                    {turn.tool ? (
                      <div className="flex items-center gap-1.5 px-1">
                        <Wrench className="size-3 text-muted" />
                        <span className="font-mono text-2xs text-muted">{turn.tool.name}</span>
                        <Badge size="sm" variant={RISK_CLASS[turn.tool.riskClass]?.variant ?? "neutral"}>
                          {RISK_CLASS[turn.tool.riskClass]?.label ?? turn.tool.riskClass}
                        </Badge>
                      </div>
                    ) : null}

                    {turn.evidence?.length ? (
                      <ul className="space-y-1 px-1">
                        {turn.evidence.map((e, i) => (
                          <li key={i} className="text-2xs">
                            {e.href ? (
                              <Link
                                href={e.href}
                                className="text-brand-text underline-offset-2 hover:underline"
                                onClick={() => onOpenChange(false)}
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
                  Running query…
                </li>
              ) : null}
            </ol>
          )}

          {error ? <ErrorState compact title="Copilot unavailable" description={error} /> : null}
        </div>

        <DrawerFooter className="space-y-2">
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
              placeholder="Ask about leads, pipeline, replies…"
              rows={2}
              className="resize-none pr-10 text-xs"
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
            <Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> newline. Actions that spend points or contact a person
            always ask first.
          </p>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
