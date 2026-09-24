"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowUp, Lock, Pencil, Plus, ShieldCheck } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api, membersApi, type Member } from "@/lib/api/client";
import { formatDate, formatInr, formatInrCompact } from "@/lib/format";

type Step = {
  id: string; key: string; order: number; phase: string; title: string; completionCriteria: string | null; dependsOn: string[];
  isClientGate: boolean; status: string; owner: { id: string; name: string } | null; artifact: string | null; note: string | null;
  clientApprovedBy: string | null; clientApprovedAt: string | null; completedAt: string | null; waitingOn: string[];
};
type Money = { invoicedInr: number; paidInr: number; entries: number };
type Data = { money?: Money; deal: { id: string; title: string; status: string; valueInr: number; company: { id: string; name: string } }; plan: { id: string; template: string; steps: Step[] } | null };

const PHASES: [string, string][] = [["sales", "Sales"], ["delivery", "Delivery"], ["cash", "Cash"]];
const STATUS: [string, string][] = [["todo", "To do"], ["in_progress", "In progress"], ["blocked", "Blocked"], ["done", "Done"], ["skipped", "Skipped"]];
const TONE: Record<string, "neutral" | "info" | "warning" | "success"> = { todo: "neutral", in_progress: "info", blocked: "warning", done: "success", skipped: "neutral" };
const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Nothing was changed.");

export function PlanView({ data, canEdit }: { data: Data; canEdit: boolean }) {
  const router = useRouter();
  const [members, setMembers] = React.useState<Member[]>([]);
  const [starting, setStarting] = React.useState(false);
  React.useEffect(() => { membersApi.list().then((r) => setMembers(r.members), () => setMembers([])); }, []);

  async function start() {
    setStarting(true);
    try { await api.post(`/api/deals/${data.deal.id}/plan`, {}); toast.success("Plan started", { description: "Eleven steps across sales, delivery and cash. Edit them to fit the deal." }); router.refresh(); }
    catch (err) { toast.error("Couldn't start the plan", { description: errorText(err) }); } finally { setStarting(false); }
  }

  const steps = data.plan?.steps ?? [];
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="xs" asChild><Link href="/teamcollab"><ArrowLeft />TeamCollab</Link></Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-primary">{data.deal.title}</h1>
          <p className="text-2xs text-muted"><Link href={`/accounts/${data.deal.company.id}`} className="hover:underline">{data.deal.company.name}</Link> · {formatInrCompact(data.deal.valueInr)} · {data.deal.status.toLowerCase()}{data.plan ? ` · ${done} of ${steps.length} done · ${data.plan.template}` : ""}</p>
        </div>
      </div>

      {!data.plan ? (
        <Card><CardContent className="space-y-2 py-5 text-sm">
          <p className="text-secondary">No plan for this deal yet. Starting one lays out eleven steps from discovery to payment — who owns each, what each depends on, and where the client has to approve.</p>
          {canEdit ? <Button variant="primary" size="sm" loading={starting} onClick={() => void start()}>Start the plan</Button> : <p className="text-2xs text-muted">You need pipeline edit access to start one.</p>}
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          {PHASES.map(([phase, label]) => (
            <Card key={phase} className="min-w-0">
              <CardHeader>
                <CardTitle>{label}</CardTitle>
                {canEdit ? <StepEditor dealId={data.deal.id} phase={phase} steps={steps} /> : null}
              </CardHeader>
              <CardContent className="space-y-2">
                {steps.filter((s) => s.phase === phase).map((s, i, arr) => <StepCard key={s.id} step={s} members={members} canEdit={canEdit} steps={steps} money={data.money} first={i === 0} last={i === arr.length - 1} />)}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StepCard({ step, members, canEdit, steps, money, first, last }: { step: Step; members: Member[]; canEdit: boolean; steps: Step[]; money?: Money; first: boolean; last: boolean }) {
  const router = useRouter();
  const [artifact, setArtifact] = React.useState(step.artifact ?? "");
  const [approver, setApprover] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const locked = step.waitingOn.length > 0;
  async function move(direction: "up" | "down") {
    setPending(true);
    try { await api.post(`/api/plan-steps/${step.id}/move`, { direction }); router.refresh(); }
    catch (err) { toast.error("Not moved", { description: errorText(err) }); } finally { setPending(false); }
  }

  async function patch(body: Record<string, unknown>, ok: string) {
    setPending(true);
    try { await api.patch(`/api/plan-steps/${step.id}`, body); toast.success(ok); router.refresh(); }
    catch (err) { toast.error("Not updated", { description: errorText(err) }); router.refresh(); } finally { setPending(false); }
  }

  return (
    <div className="space-y-1.5 rounded-md border border-border-subtle p-2 text-xs">
      <div className="flex items-start gap-1.5">
        <span className="text-2xs text-muted tabular">{step.order}.</span>
        <span className="min-w-0 flex-1 font-medium text-primary">{step.title}</span>
        {step.isClientGate ? <ShieldCheck className="size-3.5 shrink-0 text-warning-text" aria-label="Client approval step" /> : null}
        <Badge size="sm" variant={TONE[step.status] ?? "neutral"}>{STATUS.find(([v]) => v === step.status)?.[1] ?? step.status}</Badge>
        {canEdit ? (
          <span className="flex shrink-0">
            <Button variant="ghost" size="xs" aria-label={`Move ${step.title} up`} disabled={first || pending} onClick={() => void move("up")}><ArrowUp /></Button>
            <Button variant="ghost" size="xs" aria-label={`Move ${step.title} down`} disabled={last || pending} onClick={() => void move("down")}><ArrowDown /></Button>
            <StepEditor step={step} steps={steps} />
          </span>
        ) : null}
      </div>
      {money && (step.key === "invoice" || step.key === "payment") ? (
        <p className="text-2xs text-secondary">On the deal: {step.key === "invoice" ? `${formatInr(money.invoicedInr, { paise: true })} invoiced` : `${formatInr(money.paidInr, { paise: true })} received`}{money.entries === 0 ? " — nothing recorded yet (record it on the lead's deal)" : ""}. Mark the step done yourself when it is.</p>
      ) : null}
      {step.completionCriteria ? <p className="text-2xs text-muted">Done when: {step.completionCriteria}</p> : null}
      {locked && step.status !== "done" ? <p className="flex items-center gap-1 text-2xs text-secondary"><Lock className="size-2.5" />Waiting on {step.waitingOn.join(", ")}</p> : null}
      {step.clientApprovedBy ? <p className="text-2xs text-success-text">Client approval recorded: {step.clientApprovedBy}{step.clientApprovedAt ? `, ${formatDate(step.clientApprovedAt)}` : ""} — as recorded by the team, not verified.</p> : null}
      {canEdit ? (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <select aria-label={`Status of ${step.title}`} value={step.status} disabled={pending} onChange={(e) => void patch({ status: e.target.value }, "Step updated")} className="h-7 min-w-0 rounded-md border border-border bg-surface px-1.5 text-2xs">
              {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select aria-label={`Owner of ${step.title}`} value={step.owner?.id ?? ""} disabled={pending} onChange={(e) => void patch({ ownerId: e.target.value || null }, "Owner set")} className="h-7 min-w-0 rounded-md border border-border bg-surface px-1.5 text-2xs">
              <option value="">No owner</option>
              {step.owner && !members.some((m) => m.id === step.owner!.id) ? <option value={step.owner.id}>{step.owner.name}</option> : null}
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="flex gap-1.5">
            <Input aria-label={`Work for ${step.title}`} value={artifact} onChange={(e) => setArtifact(e.target.value)} placeholder="Link or note to the work" maxLength={500} className="h-7 min-w-0 flex-1 text-2xs" />
            {artifact !== (step.artifact ?? "") ? <Button size="xs" variant="secondary" disabled={pending} onClick={() => void patch({ artifact }, "Saved")}>Save</Button> : null}
          </div>
          {step.isClientGate && !step.clientApprovedBy ? (
            <div className="flex gap-1.5">
              <Input aria-label={`Who approved ${step.title}`} value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Who at the client approved" maxLength={120} className="h-7 min-w-0 flex-1 text-2xs" />
              <Button size="xs" variant="secondary" disabled={pending || approver.trim().length < 2} onClick={() => void patch({ clientApprovedBy: approver.trim() }, "Approval recorded")}>Record</Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-2xs text-muted">{step.owner ? `Owner: ${step.owner.name}` : "No owner"}{step.artifact ? ` · ${step.artifact}` : ""}</p>
      )}
    </div>
  );
}

/** Adds a step to a phase (no `step`), or edits one (with `step`): title, done-when, what it waits on. */
function StepEditor({ dealId, phase, step, steps }: { dealId?: string; phase?: string; step?: Step; steps: Step[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState(step?.title ?? "");
  const [criteria, setCriteria] = React.useState(step?.completionCriteria ?? "");
  const [deps, setDeps] = React.useState<string[]>(step?.dependsOn ?? []);
  const [gate, setGate] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const candidates = steps.filter((s) => s.key !== step?.key);

  async function save() {
    setPending(true); setError("");
    try {
      if (step) await api.patch(`/api/plan-steps/${step.id}`, { title: title.trim(), completionCriteria: criteria.trim(), dependsOn: deps });
      else await api.post(`/api/deals/${dealId}/plan/steps`, { phase, title: title.trim(), completionCriteria: criteria.trim() || undefined, dependsOn: deps, isClientGate: gate });
      toast.success(step ? "Step saved" : "Step added"); setOpen(false); router.refresh();
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }

  return (
    <>
      {step
        ? <Button variant="ghost" size="xs" aria-label={`Edit ${step.title}`} onClick={() => setOpen(true)}><Pencil /></Button>
        : <Button variant="ghost" size="xs" onClick={() => setOpen(true)}><Plus />Add step</Button>}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{step ? "Edit step" : "Add a step"}</DialogTitle>
            <DialogDescription>A step cannot start until everything it waits on is done or skipped. To take a step out of the flow, set it to Skipped.</DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[60vh] space-y-3 overflow-y-auto">
            <Field label="Step" htmlFor="ps-title" required><Input id="ps-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></Field>
            <Field label="Done when" htmlFor="ps-criteria"><Input id="ps-criteria" value={criteria} onChange={(e) => setCriteria(e.target.value)} maxLength={500} /></Field>
            <div className="space-y-1">
              <span className="text-xs font-medium text-primary">Waits on</span>
              <div className="max-h-40 space-y-0.5 overflow-y-auto rounded border border-border-subtle p-1.5">
                {candidates.map((c) => (
                  <label key={c.key} className="flex items-center gap-1.5 text-2xs text-secondary">
                    <input type="checkbox" checked={deps.includes(c.key)} onChange={(e) => setDeps((xs) => (e.target.checked ? [...xs, c.key] : xs.filter((x) => x !== c.key)))} />
                    {c.order}. {c.title}
                  </label>
                ))}
              </div>
            </div>
            {!step ? <label className="flex items-center gap-1.5 text-xs text-secondary"><input type="checkbox" checked={gate} onChange={(e) => setGate(e.target.checked)} />The client must approve this step</label> : null}
            {error ? <p className="text-xs text-danger-text">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" size="sm" loading={pending} disabled={title.trim().length < 2} onClick={() => void save()}>{step ? "Save" : "Add step"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
