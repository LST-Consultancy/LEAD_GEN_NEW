"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, dealsApi, membersApi, type Member } from "@/lib/api/client";
import type { Deal } from "@/components/pipeline/deal-card";

/** Opens the edit dialog for a deal; provided by the board, read by each card. */
export const EditDealContext = React.createContext<((dealId: string) => void) | null>(null);

/** A stored instant as the yyyy-mm-dd the date input shows, in the viewer's own calendar. */
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Midday local, so the calendar day survives any timezone the server reads it in. */
const fromDateInput = (v: string) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);

export function DealEditDialog({
  deal,
  canMarkWon,
  canMarkLost,
  onClose,
  onMarkWon,
  onMarkLost,
}: {
  deal: Deal;
  canMarkWon: boolean;
  canMarkLost: boolean;
  onClose: () => void;
  onMarkWon: () => void;
  onMarkLost: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState(deal.title);
  const [value, setValue] = React.useState(String(Math.round(deal.valueInr)));
  const [closeAt, setCloseAt] = React.useState(toDateInput(deal.expectedCloseAt));
  const [nextLabel, setNextLabel] = React.useState(deal.nextActionLabel ?? "");
  const [nextAt, setNextAt] = React.useState(toDateInput(deal.nextActionAt));
  const [ownerId, setOwnerId] = React.useState(deal.owner?.id ?? "");
  const [members, setMembers] = React.useState<Member[] | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => { membersApi.list().then((r) => setMembers(r.members), () => setMembers([])); }, []);

  const valueNumber = Number(value);
  const valueInvalid = value.trim() === "" || !Number.isFinite(valueNumber) || valueNumber < 0;
  const nextIncomplete = Boolean(nextAt) && !nextLabel.trim();

  async function save() {
    setPending(true); setError("");
    const body: Record<string, unknown> = {};
    if (title.trim() !== deal.title) body.title = title.trim();
    if (Math.round(valueNumber) !== Math.round(deal.valueInr)) body.valueInr = Math.round(valueNumber);
    if (closeAt !== toDateInput(deal.expectedCloseAt)) body.expectedCloseAt = fromDateInput(closeAt);
    if (nextLabel.trim() !== (deal.nextActionLabel ?? "")) body.nextActionLabel = nextLabel.trim() || null;
    if (nextAt !== toDateInput(deal.nextActionAt)) body.nextActionAt = fromDateInput(nextAt);
    if (ownerId && ownerId !== deal.owner?.id) body.ownerId = ownerId;
    if (Object.keys(body).length === 0) { onClose(); return; }
    try {
      await dealsApi.update(deal.id, body);
      toast.success("Deal updated");
      onClose(); router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The change wasn't saved. Nothing was changed.");
    } finally { setPending(false); }
  }

  const open = deal.status === "OPEN";
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit deal</DialogTitle>
          <DialogDescription>{deal.company.name}. Changes are recorded on the deal&apos;s history.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="deal-title">Title</Label>
            <Input id="deal-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="deal-value">Value (₹)</Label>
              <Input id="deal-value" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} className="tabular" />
              {valueInvalid ? <p className="text-2xs text-danger-text">Enter a value of zero or more.</p> : null}
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="deal-close">Expected close</Label>
              <Input id="deal-close" type="date" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="deal-next">Next action</Label>
              <Input id="deal-next" value={nextLabel} onChange={(e) => setNextLabel(e.target.value)} maxLength={200} placeholder="Send revised scope" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deal-next-at">By</Label>
              <Input id="deal-next-at" type="date" value={nextAt} onChange={(e) => setNextAt(e.target.value)} />
            </div>
          </div>
          {nextIncomplete ? <p className="text-2xs text-warning-text">Say what the next action is, not only when.</p> : null}
          <div className="space-y-1">
            <Label htmlFor="deal-owner">Owner</Label>
            <select id="deal-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={!members} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
              {!deal.owner ? <option value="">Unassigned</option> : null}
              {deal.owner && !members?.some((m) => m.id === deal.owner!.id) ? <option value={deal.owner.id}>{deal.owner.name}</option> : null}
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {error ? <p className="text-xs text-danger-text">{error}</p> : null}
        </DialogBody>
        <DialogFooter className="flex-wrap">
          {open && canMarkWon ? <Button variant="ghost" size="sm" disabled={pending} onClick={onMarkWon}>Mark won</Button> : null}
          {open && canMarkLost ? <Button variant="ghost" size="sm" disabled={pending} onClick={onMarkLost}>Mark lost…</Button> : null}
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" size="sm" loading={pending} disabled={valueInvalid || nextIncomplete || title.trim().length === 0} onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
