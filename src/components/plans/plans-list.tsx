"use client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Trash2, Workflow } from "lucide-react";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api/client";

type Row = { dealId: string; dealTitle: string; company: string; dealStatus: string; done: number; total: number; blocked: number; next: { title: string; phase: string } | null };
type Candidate = { id: string; title: string; company: string; status: string };

/** Deal plans in progress, and deals that could have one. */
type Template = { id: string; name: string; version: number; steps: number };

export function PlansList({ plans, candidates, templates = [], canConfigure = false }: { plans: Row[]; candidates: Candidate[]; templates?: Template[]; canConfigure?: boolean }) {
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
      {templates.length ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Your templates</CardTitle>
              <p className="mt-0.5 text-2xs text-muted">Saved from plans with &ldquo;Save as template&rdquo;. Removing one does not change plans already started from it.</p>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border-subtle">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-4 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-primary">{t.name} <span className="text-muted">v{t.version} · {t.steps} steps</span></span>
                  {canConfigure ? <RemoveTemplateButton id={t.id} name={t.name} /> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
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

function RemoveTemplateButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  async function remove() {
    setPending(true);
    try { await api.del(`/api/plan-templates/${id}`); toast.success(`${name} removed`, { description: "In the recycle bin if you need it back. Existing plans are unchanged." }); router.refresh(); }
    catch (err) { toast.error("Not removed", { description: err instanceof ApiError ? err.message : "Nothing was changed." }); } finally { setPending(false); }
  }
  return <Button variant="ghost" size="xs" aria-label={`Remove template ${name}`} loading={pending} onClick={() => void remove()}><Trash2 /></Button>;
}
