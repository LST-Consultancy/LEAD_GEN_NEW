"use client";

import Link from "next/link";
import { Info, Swords } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { SignalNotice } from "@/components/intelligence/signal-notice";
import { formatAge } from "@/lib/format";

type Competitor = {
  id: string;
  name: string;
  domain: string | null;
  aliases: string[];
  notes: string | null;
  isActive: boolean;
  mentionCount: number;
  companiesMentioning: number;
  mentions: {
    id: string;
    title: string;
    excerpt: string;
    source: string;
    at: string;
    company: { id: string; name: string } | null;
    leadId: string | null;
  }[];
};

export function CompetitorsView({
  competitors,
  untracked,
  freshness,
}: {
  competitors: Competitor[];
  untracked: number;
  freshness: { connected: boolean; notice: string };
}) {
  const withMentions = competitors.filter((c) => c.mentionCount > 0);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Competitors</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Who gets named in the signals you have — switching, dissatisfaction and comparison, in
          the prospect&apos;s own words rather than a battlecard&apos;s.
        </p>
      </div>

      <SignalNotice freshness={freshness} />

      {untracked > 0 ? (
        <div className="rounded-lg border border-info-border bg-info-subtle px-3 py-2 text-xs text-info-text">
          <Info className="mr-1 inline size-3.5" />
          {untracked} competitor-flavoured {untracked === 1 ? "mention matches" : "mentions match"}{" "}
          none of the names below. That is usually how you find out about a competitor you are not
          tracking yet.
        </div>
      ) : null}

      {competitors.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Swords}
              title="No competitors tracked"
              description="Add the names and aliases you compete against, and any signal mentioning them is matched here — including the ones that arrived for another reason."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {competitors.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex-row items-center justify-between">
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate">{c.name}</span>
                    {!c.isActive ? (
                      <Badge variant="neutral" size="sm">
                        Not tracked
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <p className="mt-0.5 text-2xs text-muted">
                    {c.domain ? `${c.domain} · ` : ""}
                    {c.aliases.length > 0 ? `also "${c.aliases.join('", "')}"` : "no aliases set"}
                  </p>
                  {c.notes ? <p className="mt-0.5 text-2xs text-secondary">{c.notes}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-right">
                  <div>
                    <p className="text-2xs text-muted">Mentions</p>
                    <p className="text-sm font-semibold tabular text-primary">{c.mentionCount}</p>
                  </div>
                  <Tooltip content="Distinct companies who named them. More telling than the raw mention count.">
                    <div className="cursor-help">
                      <p className="text-2xs text-muted">Companies</p>
                      <p className="text-sm font-semibold tabular text-primary">
                        {c.companiesMentioning}
                      </p>
                    </div>
                  </Tooltip>
                </div>
              </CardHeader>

              {c.mentions.length > 0 ? (
                <CardContent className="p-0">
                  <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                    {c.mentions.map((m) => (
                      <li key={m.id} className="px-4 py-2">
                        <p className="text-xs text-primary">{m.title}</p>
                        <p className="mt-0.5 text-2xs text-secondary">{m.excerpt}</p>
                        <p className="mt-0.5 text-2xs text-muted">
                          {m.company ? `${m.company.name} · ` : ""}
                          {m.source} · {formatAge(m.at)}
                          {m.leadId ? (
                            <>
                              {" · "}
                              <Link
                                href={`/leads/${m.leadId}`}
                                className="text-accent-text hover:underline"
                              >
                                open lead
                              </Link>
                            </>
                          ) : null}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {c.mentionCount > c.mentions.length ? (
                    <p className="px-4 py-2 text-2xs text-muted">
                      and {c.mentionCount - c.mentions.length} more
                    </p>
                  ) : null}
                </CardContent>
              ) : (
                <CardContent className="pt-0">
                  <p className="text-2xs text-muted">
                    Nobody in your signals has named them. That is a real finding when you have
                    signals, and no finding at all when you do not.
                  </p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {competitors.length > 0 && withMentions.length === 0 ? (
        <p className="text-2xs text-muted">
          <Info className="mr-0.5 inline size-2.5" />
          None of the tracked names appear in any signal. With no discovery source connected that
          is expected — competitor mentions arrive with the signals that carry them.
        </p>
      ) : null}
    </div>
  );
}
