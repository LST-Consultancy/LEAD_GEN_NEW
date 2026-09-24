"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bookmark, Download, ListPlus, Unlock, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, api, bulkApi, listsApi, membersApi, type BulkOutcome, type Member } from "@/lib/api/client";

export type BulkPermissions = { reveal: boolean; reassign: boolean; export: boolean; edit?: boolean };
type Mode = "reveal" | "list" | "assign" | null;

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Nothing was changed.");

function summarise(outcomes: BulkOutcome[]) {
  const ok = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.filter((o) => !o.ok);
  return { ok, failed };
}

/**
 * The Leads bulk bar. Each action calls a bulk endpoint that runs the single-lead
 * service per lead, so permissions and visibility are enforced on the server and
 * the result is reported per lead, not as one blanket success.
 */
export function BulkActions({ ids, permissions, onDone, listId }: { ids: string[]; permissions: BulkPermissions; onDone: () => void; listId?: string }) {
  const [mode, setMode] = React.useState<Mode>(null);
  const [exporting, setExporting] = React.useState(false);
  const close = () => setMode(null);

  async function exportSelected() {
    setExporting(true);
    try {
      await downloadCsv({ leadIds: ids });
      toast.success("Export downloaded", { description: "Locked contacts are marked locked, not included. The export is recorded in the audit log." });
    } catch (err) {
      toast.error("Couldn't export", { description: errorText(err) });
    } finally {
      setExporting(false);
    }
  }

  const gated = (allowed: boolean, reason: string, node: React.ReactElement) =>
    allowed ? node : <Tooltip content={reason}><span>{React.cloneElement(node as React.ReactElement<{ disabled?: boolean }>, { disabled: true })}</span></Tooltip>;

  return (
    <>
      {gated(permissions.reveal, "Your role can't reveal contacts.", <Button variant="secondary" size="sm" onClick={() => setMode("reveal")}><Unlock />Reveal contacts</Button>)}
      <Button variant="secondary" size="sm" onClick={() => setMode("list")}><ListPlus />Add to list</Button>
      {listId ? <RemoveFromListButton listId={listId} ids={ids} onDone={onDone} /> : null}
      {gated(permissions.reassign, "Reassigning needs permission to see the whole team's leads.", <Button variant="secondary" size="sm" onClick={() => setMode("assign")}><UserPlus />Assign</Button>)}
      {gated(permissions.export, "Your role can't export leads.", <Button variant="ghost" size="sm" loading={exporting} onClick={exportSelected}><Download />Export</Button>)}

      {mode === "reveal" ? <RevealDialog ids={ids} onClose={close} onDone={onDone} /> : null}
      {mode === "list" ? <ListDialog ids={ids} onClose={close} onDone={onDone} /> : null}
      {mode === "assign" ? <AssignDialog ids={ids} onClose={close} onDone={onDone} /> : null}
    </>
  );
}

/** Downloads the server's CSV. Shared with "Export all matching", which sends the filter instead of ids. */
export async function downloadCsv(body: { leadIds: string[] } | { filter: Record<string, unknown> }) {
  const res = await fetch("/api/leads/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new ApiError(payload?.error?.message ?? "The export failed. Nothing was downloaded.", "export_failed", res.status);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "leads.csv";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function Outcomes({ outcomes }: { outcomes: BulkOutcome[] }) {
  const { failed } = summarise(outcomes);
  if (!failed.length) return null;
  return (
    <ul className="max-h-32 space-y-0.5 overflow-auto rounded border border-border-subtle bg-surface-sunken p-2 text-2xs text-secondary">
      {failed.map((o) => <li key={o.leadId}>{o.message}</li>)}
    </ul>
  );
}

function RevealDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const [quote, setQuote] = React.useState<Awaited<ReturnType<typeof bulkApi.quoteReveal>> | null>(null);
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof bulkApi.reveal>> | null>(null);
  // One key per open dialog: a retried confirm charges nothing twice.
  const [key] = React.useState(() => crypto.randomUUID());

  const idKey = ids.join(",");
  React.useEffect(() => { bulkApi.quoteReveal(idKey.split(",")).then(setQuote, (err) => setError(errorText(err))); }, [idKey]);

  async function confirm() {
    setPending(true);
    try {
      const r = await bulkApi.reveal(ids, key);
      setResult(r); router.refresh();
      if (summarise(r.outcomes).failed.length === 0) { toast.success(`Revealed — ${r.pointsSpent} points spent`); onDone(); onClose(); }
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }

  const short = quote ? quote.cost > quote.balance : false;
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reveal contacts</DialogTitle>
          <DialogDescription>Charged only for contacts that actually unlock. Already-revealed and empty contacts cost nothing.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2 text-xs">
          {error ? <p className="text-danger-text">{error}</p> : !quote ? <p className="text-muted">Working out the price…</p> : result ? (
            <>
              <p className="text-primary">{summarise(result.outcomes).ok} done · {result.pointsSpent} points spent · balance {result.balance}.</p>
              <Outcomes outcomes={result.outcomes} />
            </>
          ) : (
            <>
              <p className="text-primary"><span className="tabular">{quote.contacts}</span> locked contacts across <span className="tabular">{quote.leads}</span> leads · <strong className="tabular">{quote.cost} points</strong></p>
              <p className="text-secondary">Balance: <span className="tabular">{quote.balance}</span> points.{quote.notFound ? ` ${quote.notFound} selected leads aren't visible to you and won't be touched.` : ""}</p>
              {quote.contacts === 0 ? <p className="text-secondary">Nothing locked to reveal in this selection.</p> : null}
              {short ? <p className="text-warning-text">Not enough points for all of them. Leads are revealed in order until the balance runs out; the rest are left untouched and uncharged.</p> : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>{result ? "Close" : "Cancel"}</Button>
          {!result ? <Button variant="primary" size="sm" loading={pending} disabled={!quote || quote.contacts === 0 || !!error} onClick={confirm}>Reveal for {quote?.cost ?? 0} points</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ListDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const [lists, setLists] = React.useState<{ id: string; name: string; count: number }[] | null>(null);
  const [listId, setListId] = React.useState("");
  const [newName, setNewName] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    listsApi.list().then((all) => {
      const statics = all.filter((l) => !l.isDynamic);
      // Default only; never overwrite a choice already made while this resolved.
      setLists(statics); setListId((current) => current || (statics[0]?.id ?? "new"));
    }, (err) => setError(errorText(err)));
  }, []);

  async function submit() {
    setPending(true); setError("");
    try {
      const target = listId === "new" ? (await listsApi.create({ name: newName.trim() })).list.id : listId;
      const r = await listsApi.addLeads(target, ids);
      toast.success("Added to list", { description: r.note });
      router.refresh(); onDone(); onClose();
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add {ids.length} {ids.length === 1 ? "lead" : "leads"} to a list</DialogTitle>
          <DialogDescription>Static lists hold exactly what you put in them. Smart lists fill themselves from a filter, so they aren&apos;t offered here.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          {lists === null && !error ? <p className="text-xs text-muted">Loading lists…</p> : null}
          {lists ? (
            <select aria-label="List" value={listId} onChange={(e) => setListId(e.target.value)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}
              <option value="new">New list…</option>
            </select>
          ) : null}
          {listId === "new" ? <Input aria-label="New list name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} placeholder="Q4 NetSuite targets" autoFocus /> : null}
          {error ? <p className="text-xs text-danger-text">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" size="sm" loading={pending} disabled={!lists || (listId === "new" && newName.trim().length < 2)} onClick={submit}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const [members, setMembers] = React.useState<Member[] | null>(null);
  const [ownerId, setOwnerId] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [outcomes, setOutcomes] = React.useState<BulkOutcome[] | null>(null);

  React.useEffect(() => { membersApi.list().then(({ members }) => { setMembers(members); setOwnerId(members[0]?.id ?? ""); }, (err) => setError(errorText(err))); }, []);

  async function submit() {
    setPending(true); setError("");
    try {
      const r = await bulkApi.assign(ids, ownerId === "none" ? null : ownerId);
      router.refresh();
      const { ok, failed } = summarise(r.outcomes);
      if (!failed.length) { toast.success(`${ok} ${ok === 1 ? "lead" : "leads"} reassigned`); onDone(); onClose(); } else setOutcomes(r.outcomes);
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign {ids.length} {ids.length === 1 ? "lead" : "leads"}</DialogTitle>
          <DialogDescription>The new owner sees them in their leads and queue. Each change is recorded on the lead.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          {members === null && !error ? <p className="text-xs text-muted">Loading your team…</p> : null}
          {members ? (
            <select aria-label="New owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.isYou ? " (you)" : ""}</option>)}
              <option value="none">Unassigned</option>
            </select>
          ) : null}
          {outcomes ? <><p className="text-xs text-primary">{summarise(outcomes).ok} reassigned. These were not:</p><Outcomes outcomes={outcomes} /></> : null}
          {error ? <p className="text-xs text-danger-text">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>{outcomes ? "Close" : "Cancel"}</Button>
          {!outcomes ? <Button variant="primary" size="sm" loading={pending} disabled={!members || !ownerId} onClick={submit}>Assign</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shown while viewing a static list: takes the selected leads out of it. The leads themselves are untouched. */
function RemoveFromListButton({ listId, ids, onDone }: { listId: string; ids: string[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  async function remove() {
    setPending(true);
    try {
      let removed = 0;
      for (const id of ids) removed += (await listsApi.removeLead(listId, id)).removed;
      toast.success(`${removed} removed from this list`, { description: "The leads themselves are unchanged." });
      router.refresh(); onDone();
    } catch (err) { toast.error("Couldn't remove from list", { description: errorText(err) }); } finally { setPending(false); }
  }
  return <Button variant="ghost" size="sm" loading={pending} onClick={remove}>Remove from list</Button>;
}

/** Saves the current Leads filter as a smart list that re-runs every time it is opened. */
export function SaveSmartListButton({ filter }: { filter: Record<string, unknown> }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  async function save() {
    setPending(true); setError("");
    try {
      const clean = Object.fromEntries(Object.entries(filter).filter(([k]) => !["page", "pageSize"].includes(k)));
      const r = await listsApi.create({ name: name.trim(), isDynamic: true, filter: clean });
      toast.success("Smart list saved", { description: r.note });
      setOpen(false); setName(""); router.refresh();
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }
  return (
    <>
      <Button variant="ghost" size="md" onClick={() => setOpen(true)}><ListPlus />Save as smart list</Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save these filters as a smart list</DialogTitle>
            <DialogDescription>It re-runs the current filters every time you open it, so it always shows what matches now.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <Input aria-label="Smart list name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder="Hot manufacturing CFOs" />
            {error ? <p className="text-xs text-danger-text">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" size="sm" loading={pending} disabled={name.trim().length < 2} onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Saves the current filters as a named search, optionally alerting when new
 * leads start matching. Alerts are raised by the fifteen-minute notification
 * sweep, at most once per the chosen frequency.
 */
export function SaveSearchButton({ filter }: { filter: Record<string, unknown> }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [alert, setAlert] = React.useState(true);
  const [frequency, setFrequency] = React.useState<"REALTIME" | "DAILY" | "WEEKLY">("DAILY");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  async function save() {
    setPending(true); setError("");
    try {
      const clean = Object.fromEntries(Object.entries(filter).filter(([k]) => !["page", "pageSize"].includes(k)));
      await api.post("/api/saved-searches", { name: name.trim(), surface: "leads", filter: clean, alertEnabled: alert, frequency });
      toast.success("Search saved", { description: alert ? "You'll get a notification when new leads match." : "Find it under Saved & Alerts." });
      setOpen(false); setName(""); router.refresh();
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }
  return (
    <>
      <Button variant="ghost" size="md" onClick={() => setOpen(true)}><Bookmark />Save search</Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save this search</DialogTitle>
            <DialogDescription>Opening it later restores these exact filters. An alert tells you when leads surfaced after now start matching.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <Input aria-label="Search name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder="Tier A manufacturing, buying" />
            <label className="flex items-center gap-2 text-xs text-secondary">
              <input type="checkbox" checked={alert} onChange={(e) => setAlert(e.target.checked)} />
              Alert me about new matches
            </label>
            {alert ? (
              <select aria-label="Alert frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
                <option value="REALTIME">As they appear (checked every 15 minutes)</option>
                <option value="DAILY">At most once a day</option>
                <option value="WEEKLY">At most once a week</option>
              </select>
            ) : null}
            {error ? <p className="text-xs text-danger-text">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" size="sm" loading={pending} disabled={name.trim().length < 2} onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
