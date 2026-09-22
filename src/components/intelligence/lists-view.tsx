"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Layers, RefreshCw, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { formatAge, formatNumber } from "@/lib/format";

type ListRow = {
  id: string;
  name: string;
  description: string | null;
  isDynamic: boolean;
  color: string | null;
  filter: unknown;
  count: number;
  totalMembers: number | null;
  broken: boolean;
  updatedAt: string;
};

export function ListsView({ lists }: { lists: ListRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const smart = lists.filter((l) => l.isDynamic);
  const staticLists = lists.filter((l) => !l.isDynamic);
  const broken = lists.filter((l) => l.broken);

  const remove = async (id: string) => {
    setBusy(id);
    try {
      const res = await api.del<{ note: string }>(`/api/lists/${id}`);
      setMessage(res.note);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Lists</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          A smart list re-runs its filter every time you open it. A static list holds exactly what
          someone put in it. They are shown apart because a stale set of forty and a current set
          of forty are not the same thing.
        </p>
      </div>

      {broken.length > 0 ? (
        <div className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          {broken.length === 1
            ? `"${broken[0].name}" has a saved filter this app can no longer run`
            : `${broken.length} smart lists have filters this app can no longer run`}
          , so {broken.length === 1 ? "it shows" : "they show"} nothing rather than guessing.
        </div>
      ) : null}

      {message ? (
        <p className="rounded-md border border-info-border bg-info-subtle px-3 py-2 text-xs text-info-text">
          {message}
        </p>
      ) : null}

      {lists.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Layers}
              title="No lists yet"
              description="Save a filter from the Leads screen to make a smart list, or gather leads by hand into a static one."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {smart.length > 0 ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>
                    <Zap className="mr-1 inline size-3.5" />
                    Smart lists
                  </CardTitle>
                  <p className="mt-0.5 text-2xs text-muted">
                    Counted by running the filter now, so the number is always current.
                  </p>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border-subtle">
                  {smart.map((l) => (
                    <Row key={l.id} list={l} busy={busy === l.id} onRemove={() => void remove(l.id)} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {staticLists.length > 0 ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>
                    <Layers className="mr-1 inline size-3.5" />
                    Static lists
                  </CardTitle>
                  <p className="mt-0.5 text-2xs text-muted">
                    Exactly what was put in them. They do not change on their own.
                  </p>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border-subtle">
                  {staticLists.map((l) => (
                    <Row key={l.id} list={l} busy={busy === l.id} onRemove={() => void remove(l.id)} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function Row({
  list,
  busy,
  onRemove,
}: {
  list: ListRow;
  busy: boolean;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={`/leads?listId=${list.id}`}
            className="text-xs font-medium text-primary hover:underline"
          >
            {list.name}
          </Link>
          {list.isDynamic ? (
            <Tooltip content="Re-runs its filter every time it is read.">
              <span className="cursor-help">
                <Badge variant="info" size="sm">
                  <RefreshCw className="size-2.5" />
                  Smart
                </Badge>
              </span>
            </Tooltip>
          ) : null}
          {list.broken ? (
            <Badge variant="danger" size="sm">
              Filter broken
            </Badge>
          ) : null}
        </div>
        {list.description ? (
          <p className="mt-0.5 text-2xs text-secondary">{list.description}</p>
        ) : null}
        <p className="text-2xs text-muted">updated {formatAge(list.updatedAt)}</p>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular text-primary">
          {list.broken ? "—" : formatNumber(list.count)}
        </p>
        {list.totalMembers !== null && list.totalMembers !== list.count ? (
          <Tooltip content={`${list.totalMembers} in the list; you can see ${list.count}.`}>
            <p className="cursor-help text-2xs text-muted">
              of {formatNumber(list.totalMembers)}
            </p>
          </Tooltip>
        ) : (
          <p className="text-2xs text-muted">{list.isDynamic ? "matching now" : "leads"}</p>
        )}
      </div>

      {confirming ? (
        <div className="flex shrink-0 gap-1.5">
          <Button size="xs" variant="danger" disabled={busy} onClick={onRemove}>
            Remove
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${list.name}`}
        >
          <Trash2 />
        </Button>
      )}
    </li>
  );
}
