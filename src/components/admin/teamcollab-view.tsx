"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Info, Pin, Plus, StickyNote as StickyIcon, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { formatAge } from "@/lib/format";
import { STICKY_COLORS, STICKY_KINDS, type StickyNote } from "@/lib/collab/sticky";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, { label: string; hint: string }> = {
  IDEA: { label: "Idea", hint: "Something worth trying, not yet a commitment." },
  REMINDER: { label: "Reminder", hint: "A nudge for the team. If it has a date, make it a task." },
  OBJECTION: { label: "Objection", hint: "Something a prospect said that others will hear too." },
  FOLLOW_UP: { label: "Follow-up", hint: "Loose ends that would otherwise be forgotten." },
  PERSONAL: { label: "Private", hint: "Only you can see this one." },
};

// Semantic surfaces, not raw Tailwind colours — these map to the palette's
// note swatches so they stay legible in both themes.
const COLOR_CLASS: Record<string, string> = {
  amber: "border-warning-border bg-warning-subtle",
  teal: "border-brand-border bg-brand-subtle",
  violet: "border-ai-border bg-ai-surface",
  rose: "border-danger-border bg-danger-subtle",
  slate: "border-border bg-surface-sunken",
};

/**
 * §33 — the shared scratchpad.
 *
 * These are the things a team says to each other *about* the work, which is
 * why they are not on the lead's timeline: a timeline is a record of what
 * happened, and "ask Priya to check this" is not that.
 */
export function TeamCollabView({ notes }: { notes: StickyNote[] }) {
  const router = useRouter();
  const [composing, setComposing] = React.useState(false);

  const pinned = notes.filter((n) => n.isPinned);
  const rest = notes.filter((n) => !n.isPinned);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-primary">TeamCollab</h1>
          <p className="mt-0.5 max-w-2xl text-xs text-secondary">
            A shared scratchpad for what the team says to each other about the work. Deliberately
            not on a lead&apos;s timeline — that records what happened, and this is the thinking
            around it.
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setComposing(true)}>
          <Plus />
          New note
        </Button>
      </div>

      {composing ? (
        <Composer
          onClose={() => setComposing(false)}
          onSaved={() => {
            setComposing(false);
            router.refresh();
          }}
        />
      ) : null}

      {notes.length === 0 && !composing ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState
              icon={Users}
              title="Nothing on the board"
              description="Objections you keep hearing, ideas worth trying, loose ends. Anything with a date and an owner belongs in My Queue as a task instead."
              action={
                <Button size="sm" variant="primary" onClick={() => setComposing(true)}>
                  <Plus />
                  Write the first note
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}

      {pinned.length > 0 ? (
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-muted">
            <Pin className="size-3" />
            Pinned
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pinned.map((n) => (
              <NoteCard key={n.id} note={n} onChanged={() => router.refresh()} />
            ))}
          </div>
        </div>
      ) : null}

      {rest.length > 0 ? (
        <div>
          {pinned.length > 0 ? (
            <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">
              Everything else
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((n) => (
              <NoteCard key={n.id} note={n} onChanged={() => router.refresh()} />
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-2xs leading-relaxed text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        Everyone in the workspace sees these, except notes marked private, which only their author
        can see. Only the author can edit or delete a note — nobody rewrites a colleague&apos;s
        words under their name. Anything that needs an owner and a date belongs in{" "}
        <Link href="/my-queue" className="text-brand-text underline-offset-2 hover:underline">
          My Queue
        </Link>
        .
      </p>
    </div>
  );
}

function NoteCard({ note, onChanged }: { note: StickyNote; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/sticky-notes/${note.id}`, body);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/sticky-notes/${note.id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That couldn't be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const meta = KIND_LABEL[note.kind] ?? { label: note.kind, hint: "" };

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-lg border p-2.5",
        COLOR_CLASS[note.color] ?? COLOR_CLASS.slate
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Tooltip content={meta.hint}>
          <span className="cursor-help">
            <Badge variant="neutral" size="sm">
              {meta.label}
            </Badge>
          </span>
        </Tooltip>
        <span className="ml-auto flex items-center gap-0.5">
          {note.isMine ? (
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label={note.isPinned ? "Unpin note" : "Pin note"}
                onClick={() => void patch({ isPinned: !note.isPinned })}
              >
                <Pin />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label="Delete note"
                onClick={() => void remove()}
              >
                <Trash2 />
              </Button>
            </>
          ) : null}
        </span>
      </div>

      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-primary">
        {note.body}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted">
        <span>{note.isMine ? "you" : note.authorName}</span>
        <span>· {formatAge(note.updatedAt)}</span>
        {note.leadId ? (
          <Link
            href={`/leads/${note.leadId}`}
            className="text-brand-text underline-offset-2 hover:underline"
          >
            on a lead
          </Link>
        ) : null}
      </div>

      {error ? <p className="text-2xs text-danger-text">{error}</p> : null}
    </div>
  );
}

function Composer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = React.useState<string>("IDEA");
  const [color, setColor] = React.useState<string>("amber");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/sticky-notes", { kind, color, body: body.trim() });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-2 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <StickyIcon className="size-3.5 text-muted" />
          {STICKY_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={cn(
                "rounded-md border px-2 py-0.5 text-2xs transition-colors",
                kind === k
                  ? "border-brand-border bg-brand-subtle text-primary"
                  : "border-border bg-surface text-secondary hover:border-brand-border"
              )}
            >
              {KIND_LABEL[k].label}
            </button>
          ))}
        </div>

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="text-xs"
          placeholder={KIND_LABEL[kind].hint}
          aria-label="Note body"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-muted">Colour</span>
          {STICKY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              className={cn(
                "size-4 rounded border transition-transform duration-150",
                COLOR_CLASS[c],
                color === c && "scale-125"
              )}
            />
          ))}
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || body.trim().length === 0}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Add note"}
            </Button>
          </span>
        </div>

        {error ? (
          <p className="rounded-md border border-danger-border bg-danger-subtle p-2 text-2xs text-danger-text">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
