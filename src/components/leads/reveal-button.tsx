"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, Unlock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { ApiError, leadsApi, type RevealQuote } from "@/lib/api/client";
import { VERIFICATION } from "@/lib/vocab";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  WORK_EMAIL: "Work email",
  PERSONAL_EMAIL: "Personal email",
  MOBILE: "Mobile",
  DIRECT_PHONE: "Direct line",
  SWITCHBOARD: "Switchboard",
  WHATSAPP: "WhatsApp",
};

/**
 * §20 / §63 — spending points always shows the exact price and asks first.
 * The confirmation names what will be unlocked, what it costs, and what happens
 * if verification fails, so nothing is a surprise after the fact.
 */
export function RevealButton({
  leadId,
  lockedCount,
  variant = "primary",
  size = "sm",
  label,
}: {
  leadId: string;
  lockedCount: number;
  variant?: "primary" | "secondary" | "subtle";
  size?: "xs" | "sm" | "md";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [quote, setQuote] = React.useState<RevealQuote | null>(null);
  const [loadingQuote, setLoadingQuote] = React.useState(false);
  const [quoteError, setQuoteError] = React.useState<string | null>(null);
  const [spending, setSpending] = React.useState(false);

  // A fresh key per dialog opening, so a double-submit cannot double-charge.
  const idempotencyKey = React.useRef(crypto.randomUUID());

  async function openDialog() {
    setOpen(true);
    setQuote(null);
    setQuoteError(null);
    setLoadingQuote(true);
    idempotencyKey.current = crypto.randomUUID();
    try {
      setQuote(await leadsApi.quoteReveal(leadId));
    } catch (err) {
      setQuoteError(
        err instanceof ApiError ? err.message : "We couldn't work out the price just now."
      );
    } finally {
      setLoadingQuote(false);
    }
  }

  async function confirm() {
    setSpending(true);
    try {
      const result = await leadsApi.reveal(leadId, { idempotencyKey: idempotencyKey.current });
      setOpen(false);

      const kinds = result.revealed.map((r) => KIND_LABEL[r.kind] ?? r.kind).join(", ");
      toast.success(
        `Revealed ${result.revealed.length} contact ${result.revealed.length === 1 ? "detail" : "details"}`,
        {
          description: `${kinds}. ${result.pointsSpent} ${result.pointsSpent === 1 ? "point" : "points"} spent · ${result.balance} left.`,
        }
      );

      // Anything the source couldn't supply is reported, not hidden.
      for (const s of result.skipped) {
        toast.warning(`${KIND_LABEL[s.kind] ?? s.kind} not revealed`, { description: s.reason });
      }

      router.refresh();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong. Nothing was charged.";
      toast.error("Couldn't reveal those contacts", { description: message });
    } finally {
      setSpending(false);
    }
  }

  if (lockedCount === 0) return null;

  return (
    <>
      <Tooltip
        content={`${lockedCount} locked ${lockedCount === 1 ? "detail" : "details"}. You'll see the exact cost before anything is charged.`}
      >
        <Button variant={variant} size={size} onClick={openDialog}>
          <Lock />
          {label ?? "Reveal contacts"}
        </Button>
      </Tooltip>

      <Dialog open={open} onOpenChange={(o) => !spending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reveal verified contacts</DialogTitle>
            <DialogDescription>
              Points are only spent on details we can actually return.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-3">
            {loadingQuote ? (
              <p className="text-xs text-muted">Checking what&apos;s available…</p>
            ) : quoteError ? (
              <p className="rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger-text">
                {quoteError}
              </p>
            ) : quote && quote.chargeable.length === 0 ? (
              <p className="rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-xs text-warning-text">
                There&apos;s nothing here we can unlock. The source lists methods for this person
                but returned no usable values, so there is nothing to charge for.
              </p>
            ) : quote ? (
              <>
                <ul className="space-y-1.5">
                  {quote.chargeable.map((c) => {
                    const v = VERIFICATION[c.status] ?? VERIFICATION.UNVERIFIED;
                    return (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-primary">
                            {KIND_LABEL[c.kind] ?? c.kind}
                          </span>
                          <span className="block text-2xs text-muted">
                            {c.confidence}% confidence
                          </span>
                        </span>
                        <Badge variant={v.variant} size="sm">
                          {v.label}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>

                <div className="flex items-center justify-between gap-2 rounded-md border border-brand-border bg-brand-subtle px-3 py-2">
                  <span className="text-xs text-brand-text">Total cost</span>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-text tabular">
                    <Zap className="size-3.5" />
                    {quote.cost} {quote.cost === 1 ? "point" : "points"}
                  </span>
                </div>

                <p className="text-2xs leading-relaxed text-muted">
                  If verification fails and no usable contact comes back, your points are refunded
                  automatically. Retrying this dialog never charges twice.
                </p>
              </>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={spending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={spending}
              disabled={!quote || quote.chargeable.length === 0 || loadingQuote}
              onClick={confirm}
            >
              <Unlock />
              {spending
                ? "Revealing…"
                : quote
                  ? `Spend ${quote.cost} ${quote.cost === 1 ? "point" : "points"}`
                  : "Reveal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Inline per-method reveal, for a single row in the contacts panel. */
export function RevealOneButton({
  leadId,
  contactMethodId,
  kindLabel,
}: {
  leadId: string;
  contactMethodId: string;
  kindLabel: string;
}) {
  const router = useRouter();
  const [spending, setSpending] = React.useState(false);

  async function reveal() {
    setSpending(true);
    try {
      const result = await leadsApi.reveal(leadId, {
        contactMethodIds: [contactMethodId],
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.revealed.length > 0) {
        toast.success(`${kindLabel} revealed`, {
          description: `${result.pointsSpent} point spent · ${result.balance} left.`,
        });
      }
      for (const s of result.skipped) {
        toast.warning(`${kindLabel} not revealed`, { description: s.reason });
      }
      router.refresh();
    } catch (err) {
      toast.error(`Couldn't reveal ${kindLabel.toLowerCase()}`, {
        description:
          err instanceof ApiError ? err.message : "Something went wrong. Nothing was charged.",
      });
    } finally {
      setSpending(false);
    }
  }

  return (
    <Tooltip content="Reveals the full value and charges 1 point. Nothing is charged if verification fails.">
      <Button
        variant="primary"
        size="sm"
        loading={spending}
        onClick={reveal}
        className={cn(spending && "pointer-events-none")}
      >
        {!spending && <Unlock />}
        {spending ? "…" : "1 point"}
      </Button>
    </Tooltip>
  );
}
