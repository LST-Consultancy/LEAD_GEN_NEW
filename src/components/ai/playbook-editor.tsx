"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, api } from "@/lib/api/client";
import { SIGNAL_TYPE_LABEL } from "@/lib/vocab";

export type StepOption = { name: string; kind: "control" | "tool"; implemented: boolean };
type Step = { action: string; note: string };
export type PlaybookDraft = {
  id?: string; name: string; description: string | null;
  trigger: { industries?: string[]; keywords?: string[]; signalTypes?: string[]; employeeMin?: number; employeeMax?: number; delayDays?: number };
  steps: { action: string; note?: string }[];
};

const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

/**
 * Create or edit a playbook. Steps are chosen from the actions the registry
 * knows; ones that aren't built are marked, so a playbook that would stop
 * says so before it is saved. Saving never activates it.
 */
export function PlaybookEditorButton({ initial, options, label }: { initial?: PlaybookDraft; options: StepOption[]; label: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [industries, setIndustries] = React.useState((initial?.trigger.industries ?? []).join(", "));
  const [keywords, setKeywords] = React.useState((initial?.trigger.keywords ?? []).join(", "));
  const [signalTypes, setSignalTypes] = React.useState<string[]>(initial?.trigger.signalTypes ?? []);
  const [employeeMin, setEmployeeMin] = React.useState(initial?.trigger.employeeMin?.toString() ?? "");
  const [employeeMax, setEmployeeMax] = React.useState(initial?.trigger.employeeMax?.toString() ?? "");
  const [delayDays, setDelayDays] = React.useState(initial?.trigger.delayDays?.toString() ?? "");
  const [steps, setSteps] = React.useState<Step[]>(initial?.steps.map((s) => ({ action: s.action, note: s.note ?? "" })) ?? []);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");

  const opt = (a: string) => options.find((o) => o.name === a);
  const unbuilt = steps.filter((s) => { const o = opt(s.action); return !o || (o.kind === "tool" && !o.implemented); });
  const [min, max] = [num(employeeMin), num(employeeMax)];
  const rangeBad = (min !== undefined && (!Number.isInteger(min) || min < 0)) || (max !== undefined && (!Number.isInteger(max) || max < 0)) || (min !== undefined && max !== undefined && min > max);

  const move = (i: number, d: -1 | 1) => setSteps((xs) => { const ys = [...xs]; const j = i + d; if (j < 0 || j >= ys.length) return xs; [ys[i], ys[j]] = [ys[j], ys[i]]; return ys; });

  async function save() {
    setPending(true); setError("");
    const trigger = {
      ...(list(industries).length ? { industries: list(industries) } : {}),
      ...(list(keywords).length ? { keywords: list(keywords) } : {}),
      ...(signalTypes.length ? { signalTypes } : {}),
      ...(min !== undefined ? { employeeMin: min } : {}),
      ...(max !== undefined ? { employeeMax: max } : {}),
      ...(num(delayDays) !== undefined ? { delayDays: num(delayDays) } : {}),
    };
    const body = { name: name.trim(), description: description.trim() || undefined, trigger, steps: steps.map((s, i) => ({ order: i + 1, action: s.action, ...(s.note.trim() ? { note: s.note.trim() } : {}) })) };
    try {
      if (initial?.id) await api.put(`/api/playbooks/${initial.id}`, body);
      else await api.post("/api/playbooks", body);
      toast.success(initial?.id ? "Playbook saved" : "Playbook created", { description: "It is not active. Activation is a separate step and is refused while a step can't run." });
      setOpen(false); router.refresh();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Not saved. Nothing was changed."); }
    finally { setPending(false); }
  }

  return (
    <>
      <Button variant={initial ? "ghost" : "primary"} size="sm" onClick={() => { setError(""); setOpen(true); }}>{initial ? null : <Plus />}{label}</Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{initial?.id ? "Edit playbook" : "New playbook"}</DialogTitle>
            <DialogDescription>The conditions that make a lead worth this treatment, then the steps in order.</DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[65vh] space-y-3 overflow-y-auto">
            <Field label="Name" htmlFor="pb-name" required><Input id="pb-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
            <Field label="Description" htmlFor="pb-desc"><Input id="pb-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></Field>
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted">When it applies</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Industries" htmlFor="pb-ind" hint="Comma-separated."><Input id="pb-ind" value={industries} onChange={(e) => setIndustries(e.target.value)} /></Field>
              <Field label="Keywords" htmlFor="pb-kw" hint="Comma-separated."><Input id="pb-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></Field>
              <Field label="Employees from" htmlFor="pb-min"><Input id="pb-min" inputMode="numeric" value={employeeMin} onChange={(e) => setEmployeeMin(e.target.value)} /></Field>
              <Field label="Employees to" htmlFor="pb-max" error={rangeBad ? "Whole numbers, from no more than to." : undefined}><Input id="pb-max" inputMode="numeric" value={employeeMax} onChange={(e) => setEmployeeMax(e.target.value)} /></Field>
              <Field label="Wait before starting (days)" htmlFor="pb-delay"><Input id="pb-delay" inputMode="numeric" value={delayDays} onChange={(e) => setDelayDays(e.target.value)} /></Field>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-primary">Signal types</span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(SIGNAL_TYPE_LABEL).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-2xs text-secondary">
                    <input type="checkbox" checked={signalTypes.includes(k)} onChange={(e) => setSignalTypes((xs) => (e.target.checked ? [...xs, k] : xs.filter((x) => x !== k)))} />{l}
                  </label>
                ))}
              </div>
            </div>
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted">Steps</p>
            {steps.map((s, i) => {
              const o = opt(s.action);
              return (
                <div key={i} className="space-y-1 rounded-md border border-border-subtle p-2">
                  <div className="flex items-center gap-1">
                    <span className="w-5 text-2xs text-muted tabular">{i + 1}.</span>
                    <select aria-label={`Step ${i + 1} action`} value={s.action} onChange={(e) => setSteps((xs) => xs.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))} className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 text-2xs">
                      {!o ? <option value={s.action}>{s.action} (unknown)</option> : null}
                      {options.map((x) => <option key={x.name} value={x.name}>{x.name.replaceAll("_", " ")}{x.kind === "tool" && !x.implemented ? " — not built" : ""}</option>)}
                    </select>
                    <Button variant="ghost" size="xs" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                    <Button variant="ghost" size="xs" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                    <Button variant="ghost" size="xs" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps((xs) => xs.filter((_, j) => j !== i))}><Trash2 /></Button>
                  </div>
                  <Textarea aria-label={`Step ${i + 1} note`} rows={1} value={s.note} onChange={(e) => setSteps((xs) => xs.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} maxLength={400} placeholder="What this step should do, in your words" />
                </div>
              );
            })}
            <Button variant="secondary" size="sm" disabled={steps.length >= 20} onClick={() => setSteps((xs) => [...xs, { action: options[0]?.name ?? "wait", note: "" }])}><Plus />Add step</Button>
            {unbuilt.length ? <p className="text-2xs text-warning-text">{unbuilt.length} {unbuilt.length === 1 ? "step uses an action" : "steps use actions"} that can&apos;t run yet. You can save it as a draft; activating it is refused until they can.</p> : null}
            {error ? <p className="text-xs text-danger-text">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" size="sm" loading={pending} disabled={name.trim().length < 3 || rangeBad} onClick={() => void save()}>{initial?.id ? "Save" : "Create playbook"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
