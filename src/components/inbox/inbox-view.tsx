"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  Check,
  Clock,
  CornerUpLeft,
  Inbox as InboxIcon,
  Mail,
  MailOpen,
  Send,
  Sparkles,
  ThumbsDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatAge, formatRelative } from "@/lib/format";
import { CHANNEL_LABEL, INTENT, TIER } from "@/lib/vocab";

type Conversation = {
  id: string;
  channel: string;
  subject: string | null;
  state: string;
  isUnread: boolean;
  aiSummary: string | null;
  sentiment: string | null;
  lastMessageAt: string;
  snoozedUntil: string | null;
  messageCount: number;
  company: { id: string; name: string; industry: string | null } | null;
  lead: {
    id: string;
    tier: string;
    intent: string;
    name: string;
    avatarUrl: string | null;
    score: number | null;
    hasReplied: boolean;
  } | null;
  lastMessage: { direction: string; state: string; preview: string; at: string } | null;
};

type Message = {
  id: string;
  direction: string;
  channel: string;
  state: string;
  fromAddress: string | null;
  toAddress: string | null;
  subject: string | null;
  body: string;
  actorType: string;
  generatedByAi: boolean;
  failureReason: string | null;
  sentAt: string | null;
  bouncedAt: string | null;
  createdAt: string;
  fromSequence: { sequenceId: string; name: string; stepOrder: number } | null;
};

type Detail = {
  id: string;
  channel: string;
  subject: string | null;
  state: string;
  aiSummary: string | null;
  company: { id: string; name: string; industry: string | null; city: string | null } | null;
  deal: { id: string; title: string; valueInr: number; status: string } | null;
  lead: {
    id: string;
    tier: string;
    intent: string;
    status: string;
    name: string;
    title: string | null;
    score: number | null;
    repliedAt: string | null;
    lastContactedAt: string | null;
  } | null;
  messages: Message[];
  sending: { configured: boolean; provider: string | null; canReceive: boolean };
};

type Mailbox = {
  configured: boolean;
  provider: string | null;
  canReceive: boolean;
  pendingApproval: number;
  queued: number;
  failed: number;
  lastInboundAt: string | null;
};

const FILTERS = [
  { key: "needs_you", label: "Needs you" },
  { key: "waiting", label: "Waiting" },
  { key: "open", label: "Open" },
  { key: "snoozed", label: "Snoozed" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;

/** Every state a message can be in, said plainly. */
const MESSAGE_STATE: Record<string, { label: string; tone: string; meaning: string }> = {
  DRAFT: {
    label: "Draft",
    tone: "text-muted",
    meaning: "Saved here only. Not sent, and nothing will send it.",
  },
  PENDING_APPROVAL: {
    label: "Waiting for approval",
    tone: "text-warning-text",
    meaning: "Drafted by an agent. It will not go out until someone approves it.",
  },
  QUEUED: {
    label: "Queued",
    tone: "text-info-text",
    meaning: "Waiting for the next send window and a final suppression check.",
  },
  SENT: { label: "Sent", tone: "text-success-text", meaning: "Handed to the provider." },
  DELIVERED: { label: "Delivered", tone: "text-success-text", meaning: "The provider confirmed delivery." },
  READ: { label: "Read", tone: "text-success-text", meaning: "Opened by the recipient." },
  REPLIED: { label: "Replied", tone: "text-success-text", meaning: "They answered." },
  BOUNCED: { label: "Bounced", tone: "text-danger-text", meaning: "The address rejected it." },
  FAILED: { label: "Not sent", tone: "text-danger-text", meaning: "The send was refused or failed." },
  UNSUBSCRIBED: {
    label: "Unsubscribed",
    tone: "text-danger-text",
    meaning: "They opted out; nothing further will be sent.",
  },
};

export function InboxView({
  conversations,
  counts,
  mailbox,
  activeFilter,
}: {
  conversations: Conversation[];
  counts: Record<string, number>;
  mailbox: Mailbox;
  activeFilter: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(conversations[0]?.id ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [rows, setRows] = useState(conversations);
  const [pending, startTransition] = useTransition();

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setLoadingDetail(true);
    setDetailError(null);
    try {
      setDetail(await api.get<Detail>(`/api/inbox/${id}`));
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, isUnread: false } : r)));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Could not open that thread.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // Open the first thread on arrival. Without this the list highlighted a row
  // while the reading pane still said "pick a thread", which reads as a bug.
  const openedOnMount = useRef(false);
  useEffect(() => {
    if (openedOnMount.current) return;
    const first = conversations[0]?.id;
    if (!first) return;
    openedOnMount.current = true;
    void loadDetail(first);
  }, [conversations, loadDetail]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Inbox</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Every thread with lead context beside it, so answering does not mean opening another
          screen.
        </p>
      </div>

      <MailboxBanner mailbox={mailbox} />

      <div className="flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/inbox?filter=${f.key}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors duration-150",
              activeFilter === f.key
                ? "bg-surface-active font-medium text-primary"
                : "text-secondary hover:bg-surface-hover"
            )}
          >
            {f.label}
            <span className="tabular text-2xs text-muted">{counts[f.key] ?? 0}</span>
          </Link>
        ))}
        {counts.unread > 0 ? (
          <Link
            href="/inbox?filter=unread"
            className={cn(
              "ml-1 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs",
              activeFilter === "unread"
                ? "bg-surface-active font-medium text-primary"
                : "text-secondary hover:bg-surface-hover"
            )}
          >
            <Mail className="size-3" />
            {counts.unread} unread
          </Link>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Card className="min-w-0 lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto">
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <EmptyState
                icon={InboxIcon}
                title="Nothing in this view"
                description={
                  mailbox.configured
                    ? "No threads match this filter."
                    : "No mailbox is connected, so no new mail can arrive. What is here came from the workspace's recorded history."
                }
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {rows.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => void loadDetail(c.id)}
                      className={cn(
                        "w-full px-3 py-2.5 text-left transition-colors duration-150",
                        selectedId === c.id ? "bg-surface-active" : "hover:bg-surface-hover"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <Avatar
                          name={c.lead?.name ?? c.company?.name ?? "Unknown"}
                          src={c.lead?.avatarUrl ?? undefined}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span
                              className={cn(
                                "truncate text-xs",
                                c.isUnread ? "font-semibold text-primary" : "text-secondary"
                              )}
                            >
                              {c.lead?.name ?? "Unknown contact"}
                            </span>
                            <span className="shrink-0 text-2xs text-muted">
                              {formatAge(c.lastMessageAt)}
                            </span>
                          </div>
                          <p className="truncate text-2xs text-secondary">
                            {c.company?.name ?? "No company"}
                            {c.lead ? (
                              <>
                                {" · "}
                                <span className={TIER[c.lead.tier as "A"]?.chip}>
                                  Tier {c.lead.tier}
                                </span>
                              </>
                            ) : null}
                          </p>
                          <p className="mt-0.5 truncate text-2xs text-muted">
                            {c.lastMessage ? (
                              <>
                                {c.lastMessage.direction === "INBOUND" ? (
                                  <CornerUpLeft className="mr-0.5 inline size-2.5" />
                                ) : c.lastMessage.state === "DRAFT" ? (
                                  // An unsent draft must not wear the same
                                  // icon as a sent message.
                                  <MailOpen className="mr-0.5 inline size-2.5" />
                                ) : (
                                  <Send className="mr-0.5 inline size-2.5" />
                                )}
                                {c.lastMessage.direction === "OUTBOUND" &&
                                c.lastMessage.state === "DRAFT" ? (
                                  <span className="mr-1 font-medium text-warning-text">
                                    Draft —
                                  </span>
                                ) : null}
                                {c.lastMessage.preview}
                              </>
                            ) : (
                              "No messages yet"
                            )}
                          </p>
                          {c.snoozedUntil ? (
                            <p className="mt-0.5 text-2xs text-warning-text">
                              <Clock className="mr-0.5 inline size-2.5" />
                              Back {formatRelative(c.snoozedUntil)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <ThreadPane
          detail={detail}
          loading={loadingDetail}
          error={detailError}
          mailbox={mailbox}
          onBack={() => setDetail(null)}
          onChanged={() => selectedId && void loadDetail(selectedId)}
          pending={pending}
          startTransition={startTransition}
        />
      </div>
    </div>
  );
}

function MailboxBanner({ mailbox }: { mailbox: Mailbox }) {
  if (mailbox.configured) {
    return (
      <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-secondary">
        <Check className="mr-1 inline size-3 text-success-text" />
        Connected to <strong className="text-primary">{mailbox.provider}</strong>.
        {mailbox.canReceive
          ? " Replies are read back, so sequences stop automatically when someone answers."
          : " This provider cannot read replies, so stop-on-reply has to be manual."}
        {mailbox.failed > 0 ? ` ${mailbox.failed} message(s) failed to send.` : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5 text-xs text-warning-text">
      <AlertTriangle className="mr-1 inline size-3.5" />
      <strong>No mailbox is connected</strong>, so no new mail can arrive and nothing can be
      sent. The {mailbox.pendingApproval + mailbox.queued > 0 ? "queue, " : ""}threads and
      history below are real records from this workspace — replying saves a draft and says so
      rather than pretending to send.
      {mailbox.lastInboundAt ? (
        <span className="mt-0.5 block text-2xs text-warning-text/80">
          Last message received {formatAge(mailbox.lastInboundAt)}.
        </span>
      ) : null}
    </div>
  );
}

function ThreadPane({
  detail,
  loading,
  error,
  mailbox,
  onChanged,
  pending,
  startTransition,
}: {
  detail: Detail | null;
  loading: boolean;
  error: string | null;
  mailbox: Mailbox;
  onBack: () => void;
  onChanged: () => void;
  pending: boolean;
  startTransition: (cb: () => void) => void;
}) {
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<{ sent: boolean; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [suppressOpen, setSuppressOpen] = useState(false);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-xs text-muted">Opening…</CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-xs text-danger-text">{error}</CardContent>
      </Card>
    );
  }
  if (!detail) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <InboxIcon className="mx-auto size-5 text-muted" />
          <p className="mt-2 text-xs text-secondary">Pick a thread to read it.</p>
        </CardContent>
      </Card>
    );
  }

  const reply = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await api.post<{ sent: boolean; note: string }>(
        `/api/inbox/${detail.id}/reply`,
        { body: draft }
      );
      setResult(res);
      setDraft("");
      startTransition(onChanged);
    } catch (err) {
      setResult({
        sent: false,
        note: err instanceof Error ? err.message : "Could not save that reply.",
      });
    } finally {
      setBusy(false);
    }
  };

  const setState = async (state: string, snoozedUntil?: string) => {
    setBusy(true);
    try {
      await api.patch(`/api/inbox/${detail.id}`, { state, snoozedUntil });
      startTransition(onChanged);
    } finally {
      setBusy(false);
    }
  };

  const lastAddress =
    [...detail.messages].reverse().find((m) => m.direction === "INBOUND")?.fromAddress ??
    [...detail.messages].reverse().find((m) => m.toAddress)?.toAddress ??
    null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Card className="min-w-0">
        <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="truncate">
              {detail.subject ?? "No subject"}
            </CardTitle>
            <p className="mt-0.5 truncate text-2xs text-muted">
              {detail.lead ? (
                <>
                  <Link href={`/leads/${detail.lead.id}`} className="hover:underline">
                    {detail.lead.name}
                  </Link>
                  {detail.lead.title ? ` · ${detail.lead.title}` : null}
                </>
              ) : null}
              {detail.company ? ` · ${detail.company.name}` : null}
              {` · ${CHANNEL_LABEL[detail.channel] ?? detail.channel}`}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {detail.lead ? (
              <Badge variant={detail.lead.intent === "HOT" ? "danger" : "neutral"} size="sm">
                {INTENT[detail.lead.intent as "HOT"]?.label ?? detail.lead.intent}
              </Badge>
            ) : null}
            <Tooltip content="Snooze for a day">
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={busy || pending}
                onClick={() =>
                  void setState("SNOOZED", new Date(Date.now() + 86_400_000).toISOString())
                }
                aria-label="Snooze a day"
              >
                <Clock />
              </Button>
            </Tooltip>
            <Tooltip content="Mark done and close">
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={busy || pending}
                onClick={() => void setState("CLOSED")}
                aria-label="Close thread"
              >
                <Check />
              </Button>
            </Tooltip>
            {lastAddress ? (
              <Tooltip content="Add to do-not-contact">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => setSuppressOpen(true)}
                  aria-label="Add to do-not-contact"
                >
                  <Ban />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-2 p-0">
          {detail.messages.map((m) => (
            <MessageRow key={m.id} message={m} onChanged={onChanged} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reply</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder={
              lastAddress
                ? `Write to ${lastAddress}…`
                : "This thread has no address to reply to."
            }
            disabled={!lastAddress}
            className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-primary placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-60"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={busy || draft.trim().length === 0 || !lastAddress}
              onClick={() => void reply()}
            >
              {mailbox.configured ? <Send /> : <MailOpen />}
              {mailbox.configured ? "Send" : "Save as draft"}
            </Button>
            {!mailbox.configured ? (
              <span className="text-2xs text-muted">
                No mailbox is connected, so this saves the reply on the thread. Nothing is sent.
              </span>
            ) : null}
          </div>
          {result ? (
            <p
              className={cn(
                "rounded-md px-2.5 py-2 text-2xs",
                result.sent
                  ? "bg-success-surface text-success-text"
                  : "bg-surface-sunken text-secondary"
              )}
            >
              {result.note}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {suppressOpen && lastAddress ? (
        <SuppressDialog
          address={lastAddress}
          onClose={() => setSuppressOpen(false)}
          onDone={onChanged}
        />
      ) : null}
    </div>
  );
}

function MessageRow({ message, onChanged }: { message: Message; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const meta = MESSAGE_STATE[message.state] ?? {
    label: message.state,
    tone: "text-muted",
    meaning: "",
  };
  const inbound = message.direction === "INBOUND";

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/messages/${message.id}/decide`, {
        decision,
        reason: decision === "reject" ? reason : undefined,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "border-b border-border-subtle px-3 py-2.5 last:border-0",
        inbound ? "bg-surface" : "bg-surface-sunken"
      )}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-2xs">
        <span className="break-all font-medium text-secondary">
          {inbound ? (message.fromAddress ?? "Them") : (message.fromAddress ?? "You")}
        </span>
        <span className="text-muted">{formatAge(message.createdAt)}</span>
        <Tooltip content={meta.meaning}>
          <span className={cn("cursor-help font-medium", meta.tone)}>{meta.label}</span>
        </Tooltip>
        {message.generatedByAi ? (
          <Badge variant="ai" size="sm">
            <Sparkles className="size-2.5" />
            AI draft
          </Badge>
        ) : null}
        {message.fromSequence ? (
          <span className="text-muted">
            Step {message.fromSequence.stepOrder} of “{message.fromSequence.name}”
          </span>
        ) : null}
      </div>

      <p className="whitespace-pre-wrap break-words text-xs text-primary">{message.body}</p>

      {message.failureReason ? (
        <p className="mt-1.5 rounded-md bg-danger-surface px-2 py-1.5 text-2xs text-danger-text">
          {message.failureReason}
        </p>
      ) : null}

      {message.state === "PENDING_APPROVAL" ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {rejecting ? (
            <div className="flex flex-col gap-1.5">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this not right? This is the feedback drafting learns from."
                className="text-xs"
              />
              <div className="flex gap-1.5">
                <Button
                  size="xs"
                  variant="danger"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => void decide("reject")}
                >
                  <ThumbsDown />
                  Reject
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setRejecting(false)}>
                  <X />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <Button
                size="xs"
                variant="primary"
                disabled={busy}
                onClick={() => void decide("approve")}
              >
                <Check />
                Approve
              </Button>
              <Button size="xs" variant="secondary" onClick={() => setRejecting(true)}>
                <ThumbsDown />
                Reject
              </Button>
            </div>
          )}
          {error ? <p className="text-2xs text-danger-text">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function SuppressDialog({
  address,
  onClose,
  onDone,
}: {
  address: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ note: string }>("/api/suppressions", {
        value: address,
        kind: "email",
        reason,
      });
      setNote(res.note);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add to do-not-contact</DialogTitle>
          <DialogDescription>
            Nothing will be sent to {address} from this workspace again, and any live sequence
            writing to it stops.
          </DialogDescription>
        </DialogHeader>

        {note ? (
          <>
            <DialogBody>
              <p className="rounded-md border border-success-border bg-success-subtle px-3 py-2 text-xs text-success-text">
                {note}
              </p>
            </DialogBody>
            <DialogFooter>
              <Button size="sm" variant="secondary" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogBody className="space-y-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="suppress-reason">Why</Label>
                <Input
                  id="suppress-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Asked not to be contacted again"
                />
                <p className="text-2xs text-muted">
                  Recorded with the entry so it can be justified later.
                </p>
              </div>
              {error ? (
                <p className="rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger-text">
                  {error}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busy || reason.trim().length < 3}
                onClick={() => void submit()}
              >
                <Ban />
                Add to list
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
