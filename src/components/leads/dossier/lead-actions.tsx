"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Ban, PencilLine, Star, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea, Input } from "@/components/ui/input";
import { Label, Field } from "@/components/ui/label";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError, leadsApi } from "@/lib/api/client";
import { RevealButton } from "@/components/leads/reveal-button";
import { LEAD_STATUS, type LeadStatusKey } from "@/lib/vocab";
import { cn } from "@/lib/utils";

/** Surfaces the server's own wording; falls back only for transport failures. */
function reportError(action: string, err: unknown) {
  toast.error(`Couldn't ${action}`, {
    description:
      err instanceof ApiError ? err.message : "Something went wrong. Nothing was changed.",
  });
}

/**
 * Optimistic star. The visual flips immediately and reverts if the write fails,
 * because a star is a rapid, low-stakes gesture and waiting for a round trip
 * makes it feel broken.
 */
export function StarToggle({
  leadId,
  initial,
  size = "icon-sm",
}: {
  leadId: string;
  initial: boolean;
  size?: "icon-xs" | "icon-sm";
}) {
  const router = useRouter();
  const [starred, setStarred] = React.useState(initial);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => setStarred(initial), [initial]);

  async function toggle() {
    const next = !starred;
    setStarred(next);
    setPending(true);
    try {
      await leadsApi.update(leadId, { isStarred: next });
      router.refresh();
    } catch (err) {
      setStarred(!next);
      reportError(next ? "star that lead" : "remove that star", err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Tooltip content={starred ? "Remove star" : "Star this lead"}>
      <Button
        variant="ghost"
        size={size}
        onClick={toggle}
        disabled={pending}
        aria-label={starred ? "Remove star" : "Star lead"}
        aria-pressed={starred}
      >
        <Star className={cn(starred && "fill-warning text-warning")} />
      </Button>
    </Tooltip>
  );
}

export function StatusMenu({
  leadId,
  status,
}: {
  leadId: string;
  status: LeadStatusKey;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState<string>(status);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => setValue(status), [status]);

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setPending(true);
    try {
      await leadsApi.update(leadId, { status: next });
      toast.success(`Status set to ${LEAD_STATUS[next as LeadStatusKey]?.label ?? next}`);
      router.refresh();
    } catch (err) {
      setValue(previous);
      reportError("change that status", err);
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" disabled={pending}>
          {LEAD_STATUS[value as LeadStatusKey]?.label ?? value}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Lead status</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={change}>
          {(Object.keys(LEAD_STATUS) as LeadStatusKey[]).map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {LEAD_STATUS[key].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Archive, restore and discard. Discard demands a reason because it is the only
 * feedback the targeting ever gets about a lead that should not have surfaced.
 */
export function LeadLifecycleMenu({
  leadId,
  leadName,
  isArchived,
}: {
  leadId: string;
  leadName: string;
  isArchived: boolean;
}) {
  const router = useRouter();
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function run(action: "archive" | "restore") {
    setPending(true);
    try {
      if (action === "archive") {
        await leadsApi.archive(leadId);
        toast.success(`${leadName} archived`, {
          description: "Still searchable, and restorable at any time.",
        });
      } else {
        await leadsApi.restore(leadId);
        toast.success(`${leadName} restored`);
      }
      router.refresh();
    } catch (err) {
      reportError(action === "archive" ? "archive that lead" : "restore that lead", err);
    } finally {
      setPending(false);
    }
  }

  async function discard() {
    setPending(true);
    try {
      await leadsApi.discard(leadId, reason.trim());
      setDiscardOpen(false);
      toast.success(`${leadName} discarded`, {
        description: "Recoverable from the recycle bin, and recorded as targeting feedback.",
      });
      router.refresh();
    } catch (err) {
      reportError("discard that lead", err);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={pending}>
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {isArchived ? (
            <DropdownMenuItem onSelect={() => void run("restore")}>
              <ArchiveRestore />
              Restore lead
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => void run("archive")}>
              <Archive />
              Archive lead
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            onSelect={(e) => {
              e.preventDefault();
              setReason("");
              setDiscardOpen(true);
            }}
          >
            <Ban />
            Discard as irrelevant
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={discardOpen} onOpenChange={(o) => !pending && setDiscardOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Discard {leadName}?</DialogTitle>
            <DialogDescription>
              This is the only feedback the targeting gets about leads that shouldn&apos;t have
              surfaced, so the reason matters.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <Label htmlFor="discard-reason" required>
              Why is this irrelevant?
            </Label>
            <Textarea
              id="discard-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Wrong industry — they resell rather than build"
              autoFocus
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[
                "Wrong industry",
                "Too small",
                "Too large",
                "Not a decision maker",
                "Competitor",
                "Already a customer",
                "Signal misread",
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason(preset)}
                  className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-2xs text-secondary transition-colors hover:border-border-strong hover:text-primary"
                >
                  {preset}
                </button>
              ))}
            </div>
            <p className="text-2xs text-muted">
              The lead moves to the recycle bin rather than being erased.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDiscardOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={pending}
              disabled={reason.trim().length < 3}
              onClick={discard}
            >
              Discard lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** §72/§73 — disagreeing with a score, with the reason stored as feedback. */
export function ScoreOverrideDialog({
  leadId,
  computedScore,
  currentOverride,
}: {
  leadId: string;
  computedScore: number;
  currentOverride: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [score, setScore] = React.useState(String(currentOverride ?? computedScore));
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function save(next: number | null) {
    setPending(true);
    try {
      await leadsApi.overrideScore(leadId, next, reason.trim() || undefined);
      setOpen(false);
      toast.success(
        next === null ? "Override removed" : `Score set to ${next} (engine said ${computedScore})`,
        { description: "Stored as feedback for this workspace's future scoring." }
      );
      router.refresh();
    } catch (err) {
      reportError("save that score", err);
    } finally {
      setPending(false);
    }
  }

  const parsed = Number(score);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 10;

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setScore(String(currentOverride ?? computedScore));
          setReason("");
          setOpen(true);
        }}
      >
        <PencilLine />
        Disagree with this score
      </Button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Override this score</DialogTitle>
            <DialogDescription>
              The computed score is kept alongside your override, so the disagreement itself becomes
              the training signal rather than being overwritten.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-sunken px-3 py-2">
              <span className="text-2xs uppercase tracking-wider text-muted">Engine</span>
              <span className="text-sm font-semibold text-secondary tabular">{computedScore}</span>
              <span className="text-muted">→</span>
              <span className="text-2xs uppercase tracking-wider text-muted">Yours</span>
              <Input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={score}
                onChange={(e) => setScore(e.target.value)}
                className="h-7 w-20"
                aria-label="Your score out of 10"
              />
            </div>

            <Field label="Why do you disagree?" htmlFor="override-reason" required>
              <Textarea
                id="override-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="We know this account — they've been evaluating for months, the public signal understates it."
              />
            </Field>
          </DialogBody>
          <DialogFooter className="sm:justify-between">
            {currentOverride !== null ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => void save(null)}
              >
                Remove override
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={pending}
                disabled={!valid || reason.trim().length < 3}
                onClick={() => void save(parsed)}
              >
                Save override
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Inline note composer. */
export function AddNote({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function submit() {
    setPending(true);
    try {
      await leadsApi.addNote(leadId, body.trim());
      setBody("");
      setOpen(false);
      toast.success("Note added");
      router.refresh();
    } catch (err) {
      reportError("add that note", err);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        <StickyNote />
        Add
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2">
      <Textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What did you learn? Preferences, blockers, who really signs."
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) void submit();
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="xs"
          loading={pending}
          disabled={!body.trim()}
          onClick={submit}
        >
          Save note
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Renders the reveal control in the header only when there is something locked,
 * so the header never offers an action that would do nothing.
 */
export function RevealButtonSlot({
  leadId,
  lockedContactCount,
}: {
  leadId: string;
  lockedContactCount: number;
}) {
  if (lockedContactCount === 0) return null;
  return (
    <RevealButton
      leadId={leadId}
      lockedCount={lockedContactCount}
      variant="secondary"
      label={`Reveal ${lockedContactCount}`}
    />
  );
}
