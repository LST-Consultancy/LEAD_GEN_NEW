"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ApiError, membersApi, tasksApi, type Member } from "@/lib/api/client";

/** Where "Do it" on a task goes: the lead, with the dialog for the task's channel already open. */
export function taskDoItHref(task: { lead: { id: string } | null; channel: string | null }): string | null {
  if (!task.lead) return null;
  const mode = ({ EMAIL: "email", WHATSAPP: "whatsapp", PHONE: "call", IN_PERSON: "meeting" } as Record<string, string>)[task.channel ?? ""];
  return `/leads/${task.lead.id}${mode ? `?do=${mode}` : ""}`;
}

function snoozeTimes(): [string, Date][] {
  const now = new Date();
  const at = (days: number, hour: number) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  return [["In an hour", new Date(now.getTime() + 3_600_000)], ["Tomorrow, 9:00", at(1, 9)], ["Next Monday, 9:00", at(daysToMonday, 9)]];
}

export function TaskSnoozeMenu({ taskId, onDone, size = "sm" }: { taskId: string; onDone?: () => void; size?: "sm" | "xs" }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  async function snooze(label: string, until: Date) {
    setPending(true);
    try {
      await tasksApi.snooze(taskId, until);
      toast.success("Snoozed", { description: `Back in your queue ${label.toLowerCase()}.` });
      onDone?.(); router.refresh();
    } catch (err) {
      toast.error("Couldn't snooze that", { description: err instanceof ApiError ? err.message : "Nothing was changed." });
    } finally { setPending(false); }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={size} disabled={pending}><Clock />Snooze</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {snoozeTimes().map(([label, until]) => (
          <DropdownMenuItem key={label} onSelect={() => void snooze(label, until)}>{label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TaskDelegateButton({ taskId, currentOwnerId, onDone, size = "sm" }: { taskId: string; currentOwnerId?: string | null; onDone?: () => void; size?: "sm" | "xs" }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [members, setMembers] = React.useState<Member[] | null>(null);
  const [ownerId, setOwnerId] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");

  async function openDialog() {
    setOpen(true); setError("");
    try {
      const { members } = await membersApi.list();
      setMembers(members);
      setOwnerId(members.find((m) => m.id !== currentOwnerId)?.id ?? "");
    } catch { setError("Couldn't load your team."); }
  }
  async function submit() {
    setPending(true);
    try {
      await tasksApi.update(taskId, { ownerId });
      toast.success("Delegated", { description: `Now in ${members?.find((m) => m.id === ownerId)?.name ?? "their"}'s queue.` });
      setOpen(false); onDone?.(); router.refresh();
    } catch (err) {
      toast.error("Couldn't delegate that", { description: err instanceof ApiError ? err.message : "Nothing was changed." });
    } finally { setPending(false); }
  }
  const others = (members ?? []).filter((m) => m.id !== currentOwnerId);

  return (
    <>
      <Button variant="ghost" size={size} onClick={openDialog}><UserPlus />Delegate</Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delegate this task</DialogTitle>
            <DialogDescription>It moves to their queue. The change is recorded on the task&apos;s history.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {error ? <p className="text-xs text-danger-text">{error}</p>
              : members === null ? <p className="text-xs text-muted">Loading your team…</p>
              : others.length === 0 ? <p className="text-xs text-secondary">Nobody else is in this workspace yet. Invite a teammate from Settings → Team.</p>
              : (
                <select aria-label="Delegate to" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
                  {others.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" size="sm" loading={pending} disabled={!ownerId || others.length === 0} onClick={submit}>Delegate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Completing a task: hidden at once, saved, and put back with a message if the
 * save fails. Undo reopens it on the server too. Previously the tick only hid
 * the row and said "Marked done", so the task came back on the next refresh.
 */
export function useTaskCompletion() {
  const router = useRouter();
  const [completed, setCompleted] = React.useState<Set<string>>(new Set());
  const unhide = (id: string) => setCompleted((prev) => { const next = new Set(prev); next.delete(id); return next; });

  const complete = React.useCallback(async (task: { id: string; title: string }) => {
    setCompleted((prev) => new Set(prev).add(task.id));
    try {
      await tasksApi.complete(task.id);
      toast.success("Marked done", {
        description: task.title,
        action: {
          label: "Undo",
          onClick: async () => {
            try { await tasksApi.update(task.id, { status: "QUEUED" }); unhide(task.id); router.refresh(); }
            catch (err) { toast.error("Couldn't reopen it", { description: err instanceof ApiError ? err.message : "It stays done." }); }
          },
        },
      });
      router.refresh();
    } catch (err) {
      unhide(task.id);
      toast.error("Couldn't complete that task", { description: `${err instanceof ApiError ? err.message : "The server didn't save it."} "${task.title}" is back in your list.` });
    }
  }, [router]);

  return { completed, complete };
}
