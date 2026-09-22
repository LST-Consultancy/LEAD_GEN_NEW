"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "@/components/ui/drawer";
import { api } from "@/lib/api/client";
import { formatAge, formatNumber } from "@/lib/format";
import { KNOWLEDGE_KIND, KNOWLEDGE_KINDS, kindLabel, type KnowledgeKind } from "@/lib/knowledge/kinds";
import type { KnowledgeCoverage, KnowledgeSummary } from "@/lib/services/knowledge";
import { cn } from "@/lib/utils";

/**
 * §64 — the knowledge base.
 *
 * Its whole purpose is to bound what a generated draft may claim, so the screen
 * leads with coverage: which kinds are empty, and what that means for the
 * features that read from here. A grid of cards would hide exactly that.
 */
export function KnowledgeView({
  docs,
  coverage,
  activeTotal,
  canManage,
}: {
  docs: KnowledgeSummary[];
  coverage: KnowledgeCoverage[];
  activeTotal: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<KnowledgeSummary | "new" | null>(null);

  const filtered = docs.filter((d) => {
    if (kind && d.kind !== kind) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      d.title.toLowerCase().includes(q) ||
      d.body.toLowerCase().includes(q) ||
      d.tags.some((t) => t.includes(q))
    );
  });

  const missing = coverage.filter((c) => c.active === 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-primary">Knowledge Base</h1>
          <p className="mt-0.5 max-w-2xl text-xs text-secondary">
            What you actually sell, in your own words. Drafting and proposal features read from
            here, so an entry that isn&apos;t written is a claim they cannot make — which is the
            point.
          </p>
        </div>
        {canManage ? (
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
            <Plus />
            Add entry
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-1.5">
            <BookOpen className="size-3.5 text-muted" />
            Coverage
          </CardTitle>
          <span className="text-2xs text-muted">
            {formatNumber(activeTotal)} active {activeTotal === 1 ? "entry" : "entries"}
          </span>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {coverage.map((c) => (
              <button
                key={c.kind}
                type="button"
                onClick={() => setKind(kind === c.kind ? null : c.kind)}
                aria-pressed={kind === c.kind}
                className={cn(
                  "rounded-md border p-2.5 text-left transition-colors",
                  kind === c.kind
                    ? "border-brand-border bg-brand-subtle"
                    : "border-border bg-surface hover:border-brand-border",
                  c.active === 0 && "border-dashed"
                )}
              >
                <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                  {KNOWLEDGE_KIND[c.kind].label}
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-sm font-semibold tabular-nums",
                    c.active === 0 ? "text-muted" : "text-primary"
                  )}
                >
                  {c.active}
                  {c.total > c.active ? (
                    <Tooltip content={`${c.total - c.active} retired and not used for grounding.`}>
                      <span className="ml-1 cursor-help text-2xs font-normal text-muted">
                        +{c.total - c.active} retired
                      </span>
                    </Tooltip>
                  ) : null}
                </p>
                <p className="mt-1 text-2xs leading-relaxed text-muted">
                  {KNOWLEDGE_KIND[c.kind].purpose}
                </p>
              </button>
            ))}
          </div>

          {missing.length ? (
            <div className="mt-3 flex gap-2 rounded-md border border-warning-border bg-warning-subtle p-2.5 text-2xs leading-relaxed text-warning-text">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Nothing written for{" "}
                <strong>{missing.map((m) => KNOWLEDGE_KIND[m.kind].label.toLowerCase()).join(", ")}</strong>
                . Anything that would have drawn on those has nothing to draw on — it will say so
                rather than fill the gap.
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, body and tags…"
          className="sm:max-w-xs"
          aria-label="Search the knowledge base"
        />
        {kind ? (
          <Button size="sm" variant="ghost" onClick={() => setKind(null)}>
            Clear {kindLabel(kind)} filter
          </Button>
        ) : null}
        <span className="text-2xs text-muted">
          {filtered.length} of {docs.length} shown
        </span>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState
              title={docs.length === 0 ? "Nothing here yet" : "Nothing matches"}
              description={
                docs.length === 0
                  ? "Start with one service you sell — its real scope, its price band and what it excludes. That single entry is what stops a draft inventing a capability."
                  : "No entry matches this search. Clear the filter to see everything."
              }
              action={
                docs.length === 0 && canManage ? (
                  <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
                    <Plus />
                    Add the first entry
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="space-y-1.5 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge size="sm" variant="neutral">
                    {kindLabel(doc.kind)}
                  </Badge>
                  <span className="text-xs font-medium text-primary">{doc.title}</span>
                  {doc.isActive ? null : (
                    <Tooltip content="Retired. Kept for reference, but no feature grounds on it.">
                      <span className="cursor-help">
                        <Badge size="sm" variant="warning">
                          Retired
                        </Badge>
                      </span>
                    </Tooltip>
                  )}
                  <span className="ml-auto flex items-center gap-1">
                    {canManage ? (
                      <>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Edit ${doc.title}`}
                          onClick={() => setEditing(doc)}
                        >
                          <Pencil />
                        </Button>
                        <DeleteButton doc={doc} onDone={() => router.refresh()} />
                      </>
                    ) : null}
                  </span>
                </div>
                <p className="text-2xs leading-relaxed text-secondary">{doc.body}</p>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {doc.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-subtle px-1.5 py-0.5 font-mono text-2xs text-muted"
                    >
                      {t}
                    </span>
                  ))}
                  <span className="ml-auto text-2xs text-muted">
                    {formatNumber(doc.length)} characters · updated {formatAge(doc.updatedAt)}
                    {doc.createdByName ? ` · added by ${doc.createdByName}` : ""}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-2xs leading-relaxed text-muted">
        Grounding is only as good as what is written here. The{" "}
        <Link href="/copilot" className="text-brand-text underline-offset-2 hover:underline">
          Copilot
        </Link>{" "}
        answers from your records rather than from this base; these entries bound what drafting and
        proposal features may claim, once those are wired to a model.
      </p>

      {editing ? (
        <KnowledgeEditor
          doc={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function DeleteButton({ doc, onDone }: { doc: KnowledgeSummary; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  if (!confirming) {
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Delete ${doc.title}`}
        onClick={() => setConfirming(true)}
      >
        <Trash2 />
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <span className="text-2xs text-muted">Delete?</span>
      <Button
        size="sm"
        variant="danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.del(`/api/knowledge/${doc.id}`);
            onDone();
          } finally {
            setBusy(false);
            setConfirming(false);
          }
        }}
      >
        Yes
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        No
      </Button>
    </span>
  );
}

function KnowledgeEditor({
  doc,
  onClose,
  onSaved,
}: {
  doc: KnowledgeSummary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = React.useState<KnowledgeKind>(
    (doc?.kind as KnowledgeKind) ?? "service"
  );
  const [title, setTitle] = React.useState(doc?.title ?? "");
  const [body, setBody] = React.useState(doc?.body ?? "");
  const [tags, setTags] = React.useState(doc?.tags.join(", ") ?? "");
  const [isActive, setIsActive] = React.useState(doc?.isActive ?? true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Mirrors the server schema, so the button is disabled for the same reasons
  // the request would be rejected — rather than failing after a round trip.
  const tooShort = body.trim().length < 20;
  const titleTooShort = title.trim().length < 3;

  async function save() {
    setBusy(true);
    setError(null);
    const payload = {
      kind,
      title: title.trim(),
      body: body.trim(),
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      isActive,
    };
    try {
      if (doc) await api.put(`/api/knowledge/${doc.id}`, payload);
      else await api.post("/api/knowledge", payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That couldn't be saved. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onOpenChange={(open) => (open ? null : onClose())}>
      <DrawerContent side="right" className="sm:max-w-[520px]">
        <DrawerHeader>
          <DrawerTitle>{doc ? "Edit entry" : "New entry"}</DrawerTitle>
          <p className="text-2xs text-muted">{KNOWLEDGE_KIND[kind].prompt}</p>
        </DrawerHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div>
            <label className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted">
              Kind
            </label>
            <div className="flex flex-wrap gap-1.5">
              {KNOWLEDGE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={cn(
                    "rounded-md border px-2 py-1 text-2xs transition-colors",
                    kind === k
                      ? "border-brand-border bg-brand-subtle text-primary"
                      : "border-border bg-surface text-secondary hover:border-brand-border"
                  )}
                >
                  {KNOWLEDGE_KIND[k].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="kb-title"
              className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted"
            >
              Title
            </label>
            <Input
              id="kb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Salesforce implementation and migration"
            />
          </div>

          <div>
            <label
              htmlFor="kb-body"
              className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted"
            >
              Body
            </label>
            <Textarea
              id="kb-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="text-xs"
              placeholder={KNOWLEDGE_KIND[kind].prompt}
            />
            <p className="mt-1 text-2xs text-muted">
              {formatNumber(body.trim().length)} characters
              {tooShort ? " — at least 20 needed to be worth grounding on" : ""}
            </p>
          </div>

          <div>
            <label
              htmlFor="kb-tags"
              className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted"
            >
              Tags
            </label>
            <Input
              id="kb-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="salesforce, crm, implementation"
            />
            <p className="mt-1 text-2xs text-muted">
              Comma separated, lower-cased on save so one spelling wins.
            </p>
          </div>

          <label className="flex items-start gap-2 text-2xs text-secondary">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Active. Retiring an entry keeps it for reference but stops every feature grounding on
              it — use that rather than deleting something you may want back.
            </span>
          </label>

          {error ? (
            <p className="rounded-md border border-danger-border bg-danger-subtle p-2 text-2xs text-danger-text">
              {error}
            </p>
          ) : null}
        </div>

        <DrawerFooter className="flex-row justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void save()}
            disabled={busy || tooShort || titleTooShort}
          >
            {busy ? "Saving…" : doc ? "Save changes" : "Add entry"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
