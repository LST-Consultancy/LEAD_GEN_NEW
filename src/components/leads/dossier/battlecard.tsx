"use client";

import * as React from "react";
import Link from "next/link";
import { Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import type { Battlecard, BattlecardPoint } from "@/lib/services/battlecard";

const SECTIONS: [keyof Omit<Battlecard, "missing">, string][] = [
  ["pain", "Their pain, from signals"],
  ["talkingPoints", "What you can say"],
  ["objections", "Objections to expect"],
  ["proof", "Proof"],
  ["competitors", "Competitors mentioned"],
];

/** Evidence assembled for a call. Each line names the row it came from; no model wrote any of it. */
export function BattlecardPanel({ leadId }: { leadId: string }) {
  const [card, setCard] = React.useState<Battlecard | null>(null);
  const [error, setError] = React.useState("");
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open || card) return;
    api.get<Battlecard>(`/api/leads/${leadId}/battlecard`).then(setCard, () => setError("Couldn't build the battlecard."));
  }, [open, card, leadId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5"><Swords className="size-3.5 text-muted" />Battlecard</CardTitle>
        <Button variant="ghost" size="xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide" : "Show"}</Button>
      </CardHeader>
      {open ? (
        <CardContent className="space-y-3 text-xs">
          {error ? <p className="text-danger-text">{error}</p> : !card ? <p className="text-muted">Assembling from this lead&apos;s evidence…</p> : (
            <>
              <p className="text-2xs text-muted">Assembled from signals, your Knowledge Base and team notes. Nothing here was generated; each line shows its source.</p>
              {SECTIONS.map(([key, label]) => (card[key] as BattlecardPoint[]).length ? (
                <section key={key} className="space-y-1">
                  <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted">{label}</h3>
                  <ul className="space-y-1">
                    {(card[key] as BattlecardPoint[]).map((p) => (
                      <li key={`${p.source.kind}-${p.source.id}`} className="leading-relaxed text-secondary">
                        {p.text} <span className="text-2xs text-muted">— {p.source.kind === "knowledge" ? "Knowledge Base" : p.source.kind === "signal" ? "signal" : "note"}: {p.source.label}{p.source.kind === "knowledge" && !p.relevant ? " (general)" : ""}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null)}
              {card.missing.length ? (
                <div className="space-y-0.5 rounded bg-surface-sunken p-2 text-2xs text-secondary">
                  {card.missing.map((m) => <p key={m}>{m}</p>)}
                  <Link href="/knowledge-base" className="text-brand-text hover:underline">Open the Knowledge Base</Link>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}
