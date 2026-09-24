"use client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Workflow } from "lucide-react";

type Row = { dealId: string; dealTitle: string; company: string; dealStatus: string; done: number; total: number; blocked: number; next: { title: string; phase: string } | null };
type Candidate = { id: string; title: string; company: string; status: string };

/** Deal plans in progress, and deals that could have one. */
export function PlansList({ plans, candidates }: { plans: Row[]; candidates: Candidate[] }) {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Deal plans</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">Sales, delivery and cash steps per deal — who owns each, what it waits on, and where the client approves.</p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {plans.length === 0 ? (
            <EmptyState icon={Workflow} title="No plans yet" description="Open a deal below and start its plan. It lays out eleven steps from discovery to payment that you can assign and track." />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {plans.map((p) => (
                <li key={p.dealId}>
                  <Link href={`/teamcollab/${p.dealId}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs hover:bg-surface-hover">
                    <span className="min-w-0 flex-1 truncate"><span className="font-medium text-primary">{p.dealTitle}</span> <span className="text-muted">· {p.company}</span></span>
                    <span className="tabular text-secondary">{p.done}/{p.total}</span>
                    {p.blocked ? <Badge size="sm" variant="warning">{p.blocked} blocked</Badge> : null}
                    <span className="w-44 truncate text-right text-2xs text-muted">{p.next ? `Next: ${p.next.title}` : "All steps done"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {candidates.length ? (
        <Card>
          <CardHeader><CardTitle>Deals without a plan</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border-subtle">
              {candidates.map((d) => (
                <li key={d.id}>
                  <Link href={`/teamcollab/${d.id}`} className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-surface-hover">
                    <span className="min-w-0 flex-1 truncate text-primary">{d.title} <span className="text-muted">· {d.company}</span></span>
                    <span className="text-2xs text-muted">{d.status.toLowerCase()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
