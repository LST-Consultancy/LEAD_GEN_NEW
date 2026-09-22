"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Crosshair,
  Info,
  Plus,
  Star,
  Target,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { Metric } from "@/components/charts/metric";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { TagInput } from "@/components/icp/tag-input";
import { ApiError, api } from "@/lib/api/client";
import { formatInrCompact, formatAge } from "@/lib/format";
import { cn } from "@/lib/utils";

export type IcpProfile = {
  id: string;
  name: string;
  isPrimary: boolean;
  sellsDescription: string | null;
  industries: string[];
  locations: string[];
  employeeMin: number | null;
  employeeMax: number | null;
  revenueMinInr: number | null;
  revenueMaxInr: number | null;
  buyerRoles: string[];
  seniorities: string[];
  technologies: string[];
  pains: string[];
  triggerEvents: string[];
  exclusions: string[];
  updatedAt: string;
  stats: {
    leadCount: number;
    tierA: number;
    tierB: number;
    precision: number | null;
    wonCount: number;
    wonInr: number;
  };
};

export type IcpFacets = {
  industries: string[];
  cities: string[];
  states: string[];
  technologies: string[];
  seniorities: string[];
  departments: string[];
};

const SENIORITY_OPTIONS = [
  "founder", "c-level", "owner", "president", "vp", "director", "head",
  "senior_manager", "manager", "lead", "senior", "individual",
];

function blankProfile(): Omit<IcpProfile, "id" | "updatedAt" | "stats"> {
  return {
    name: "",
    isPrimary: false,
    sellsDescription: null,
    industries: [],
    locations: [],
    employeeMin: null,
    employeeMax: null,
    revenueMinInr: null,
    revenueMaxInr: null,
    buyerRoles: [],
    seniorities: [],
    technologies: [],
    pains: [],
    triggerEvents: [],
    exclusions: [],
  };
}

export function IcpEditor({
  profiles,
  facets,
}: {
  profiles: IcpProfile[];
  facets: IcpFacets;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = React.useState<string | null>(profiles[0]?.id ?? null);
  const [creating, setCreating] = React.useState(profiles.length === 0);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-primary">
          Ideal customer profile
        </h1>
        <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-secondary">
          Every lead score is computed against one of these. Changing a profile invalidates the
          scores derived from it, so saving queues a recompute rather than leaving the numbers
          quietly wrong.
        </p>
      </header>

      {profiles.length === 0 && !creating ? (
        <Card>
          <EmptyState
            icon={Crosshair}
            title="No ICP defined yet"
            description="Scoring has nothing to measure against until you describe who you sell to. You can write it in plain language and have the fields filled in for you."
            action={
              <Button size="sm" variant="primary" asChild>
                <Link href="/find-leads">Describe it in plain language</Link>
              </Button>
            }
            secondaryAction={
              <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
                Fill the form myself
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* Profile list */}
          <div className="space-y-2">
            <ul className="space-y-1">
              {profiles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(p.id);
                      setCreating(false);
                    }}
                    aria-current={selectedId === p.id && !creating ? "true" : undefined}
                    className={cn(
                      "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
                      selectedId === p.id && !creating
                        ? "border-brand bg-brand-subtle"
                        : "border-border bg-surface hover:border-border-strong"
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">
                        {p.name}
                      </span>
                      {p.isPrimary ? (
                        <Tooltip content="New leads score against the primary profile by default.">
                          <Star className="size-3 shrink-0 fill-warning text-warning" />
                        </Tooltip>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-2xs text-muted tabular">
                      {p.stats.leadCount} leads
                      {p.stats.precision !== null ? ` · ${p.stats.precision}% A/B` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => {
                setCreating(true);
                setSelectedId(null);
              }}
            >
              <Plus />
              New profile
            </Button>

            <Card className="mt-3">
              <CardContent className="pt-3">
                <p className="flex gap-1.5 text-2xs leading-relaxed text-muted">
                  <Info className="mt-0.5 size-3 shrink-0" />
                  Multiple profiles let you score different segments on their own terms. A SaaS
                  buyer and a manufacturing buyer rarely share a definition.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Editor */}
          <div className="min-w-0">
            {creating ? (
              <ProfileForm
                key="new"
                initial={blankProfile()}
                facets={facets}
                isFirst={profiles.length === 0}
                onSaved={(id) => {
                  setCreating(false);
                  setSelectedId(id);
                  router.refresh();
                }}
                onCancel={profiles.length > 0 ? () => setCreating(false) : undefined}
              />
            ) : selected ? (
              <ProfileForm
                key={selected.id}
                profileId={selected.id}
                initial={selected}
                stats={selected.stats}
                facets={facets}
                canDelete={profiles.length > 1 && selected.stats.leadCount === 0}
                deleteBlockedReason={
                  profiles.length <= 1
                    ? "This is your only profile. Scoring needs at least one."
                    : selected.stats.leadCount > 0
                      ? `${selected.stats.leadCount} leads are scored against this profile.`
                      : undefined
                }
                onSaved={() => router.refresh()}
                onDeleted={() => {
                  setSelectedId(profiles.find((p) => p.id !== selected.id)?.id ?? null);
                  router.refresh();
                }}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileForm({
  profileId,
  initial,
  stats,
  facets,
  isFirst,
  canDelete,
  deleteBlockedReason,
  onSaved,
  onCancel,
  onDeleted,
}: {
  profileId?: string;
  initial: Omit<IcpProfile, "id" | "updatedAt" | "stats"> & Partial<Pick<IcpProfile, "updatedAt">>;
  stats?: IcpProfile["stats"];
  facets: IcpFacets;
  isFirst?: boolean;
  canDelete?: boolean;
  deleteBlockedReason?: string;
  onSaved: (id: string) => void;
  onCancel?: () => void;
  onDeleted?: () => void;
}) {
  const [form, setForm] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [preview, setPreview] = React.useState<{
    matching: number;
    total: number;
    sample: { id: string; name: string; company: string; score: number | null }[];
    note: string;
  } | null>(null);
  const [previewing, setPreviewing] = React.useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const rangeInvalid =
    form.employeeMin != null && form.employeeMax != null && form.employeeMin > form.employeeMax;
  const noCriteria =
    form.industries.length === 0 &&
    form.locations.length === 0 &&
    form.technologies.length === 0 &&
    form.employeeMin == null &&
    form.employeeMax == null;

  async function save() {
    setSaving(true);
    try {
      const body = { ...form, sellsDescription: form.sellsDescription || null };
      if (profileId) {
        const result = await api.patch<{ id: string; rescoreNote?: string }>(
          `/api/icp/${profileId}`,
          body
        );
        toast.success("ICP saved", { description: result.rescoreNote });
        onSaved(profileId);
      } else {
        const result = await api.post<{ id: string }>("/api/icp", body);
        toast.success("ICP profile created");
        onSaved(result.id);
      }
    } catch (err) {
      toast.error("Couldn't save that profile", {
        description:
          err instanceof ApiError ? err.message : "Something went wrong. Nothing was changed.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    setPreviewing(true);
    try {
      setPreview(await api.post("/api/icp/preview", { ...form, name: form.name || "Draft" }));
    } catch (err) {
      toast.error("Couldn't preview that", {
        description: err instanceof ApiError ? err.message : "Something went wrong.",
      });
    } finally {
      setPreviewing(false);
    }
  }

  async function remove() {
    if (!profileId) return;
    setDeleting(true);
    try {
      await api.del(`/api/icp/${profileId}`);
      toast.success("Profile removed");
      setConfirmDelete(false);
      onDeleted?.();
    } catch (err) {
      toast.error("Couldn't remove that profile", {
        description: err instanceof ApiError ? err.message : "Something went wrong.",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* How this profile is performing */}
      {stats ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-1.5">
                <TrendingUp className="size-3.5" />
                How this definition is performing
              </CardTitle>
              <p className="mt-0.5 text-2xs text-muted">
                Computed from leads actually scored against it
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Metric label="Leads scored" value={String(stats.leadCount)} size="sm" />
              <Metric
                label="Rated A or B"
                value={stats.precision !== null ? `${stats.precision}%` : "—"}
                sub={`${stats.tierA} A · ${stats.tierB} B`}
                size="sm"
                tone={
                  stats.precision === null
                    ? "neutral"
                    : stats.precision >= 30
                      ? "good"
                      : stats.precision >= 15
                        ? "warning"
                        : "serious"
                }
                hint="The share this definition rates highly. A low number usually means the definition is too broad, not that the leads are bad."
              />
              <Metric label="Deals won" value={String(stats.wonCount)} size="sm" tone="good" />
              <Metric
                label="Revenue won"
                value={stats.wonInr > 0 ? formatInrCompact(stats.wonInr) : "—"}
                size="sm"
                tone="good"
              />
            </div>
            {stats.leadCount > 20 && (stats.precision ?? 0) < 15 ? (
              <p className="mt-2.5 flex items-start gap-1.5 rounded-md border border-warning-border bg-warning-subtle px-2.5 py-2 text-2xs leading-relaxed text-warning-text">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {stats.leadCount} leads and only {stats.precision}% rate A or B. This definition is
                probably too broad — narrowing the headcount band or the industry list usually
                helps more than adding criteria.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>{profileId ? "Edit profile" : "New profile"}</CardTitle>
            {initial.updatedAt ? (
              <p className="mt-0.5 text-2xs text-muted">
                Last changed {formatAge(initial.updatedAt)}
              </p>
            ) : null}
          </div>
          {dirty ? (
            <Badge variant="warning" size="lg" uppercase>
              Unsaved
            </Badge>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4">
          <Field label="Profile name" htmlFor="icp-name" required>
            <Input
              id="icp-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Mid-market manufacturing & logistics"
            />
          </Field>

          <Field
            label="What do you sell to them?"
            htmlFor="icp-sells"
            hint="Used to ground AI drafting later. It is not matched against anything, so write it for a human."
          >
            <Textarea
              id="icp-sells"
              rows={3}
              value={form.sellsDescription ?? ""}
              onChange={(e) => set("sellsDescription", e.target.value)}
              placeholder="Salesforce and ERP implementation plus AI automation for Indian mid-market businesses that still run core operations on spreadsheets."
            />
          </Field>

          <Separator />

          <div>
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted">
              Firm attributes — these decide whether a lead matches
            </p>
            <div className="space-y-3">
              <TagInput
                label="Industries"
                values={form.industries}
                onChange={(v) => set("industries", v)}
                suggestions={facets.industries}
                placeholder="Manufacturing"
              />
              <TagInput
                label="Locations"
                hint="States or cities. A lead in a listed region scores higher; it is not a hard filter."
                values={form.locations}
                onChange={(v) => set("locations", v)}
                suggestions={[...facets.states, ...facets.cities]}
                placeholder="Maharashtra"
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Headcount range"
                  htmlFor="emp-min"
                  error={rangeInvalid ? "The minimum is above the maximum, so nothing could match." : undefined}
                >
                  <div className="flex items-center gap-2">
                    <Input
                      id="emp-min"
                      type="number"
                      min={0}
                      placeholder="Min"
                      value={form.employeeMin ?? ""}
                      onChange={(e) =>
                        set("employeeMin", e.target.value === "" ? null : Number(e.target.value))
                      }
                      aria-invalid={rangeInvalid || undefined}
                    />
                    <span className="text-xs text-muted">to</span>
                    <Input
                      type="number"
                      min={0}
                      placeholder="Max"
                      value={form.employeeMax ?? ""}
                      onChange={(e) =>
                        set("employeeMax", e.target.value === "" ? null : Number(e.target.value))
                      }
                      aria-label="Maximum headcount"
                      aria-invalid={rangeInvalid || undefined}
                    />
                  </div>
                </Field>

                <Field label="Annual revenue (₹)" htmlFor="rev-min" hint="Optional">
                  <div className="flex items-center gap-2">
                    <Input
                      id="rev-min"
                      type="number"
                      min={0}
                      step={1_000_000}
                      placeholder="Min"
                      value={form.revenueMinInr ?? ""}
                      onChange={(e) =>
                        set("revenueMinInr", e.target.value === "" ? null : Number(e.target.value))
                      }
                    />
                    <span className="text-xs text-muted">to</span>
                    <Input
                      type="number"
                      min={0}
                      step={1_000_000}
                      placeholder="Max"
                      value={form.revenueMaxInr ?? ""}
                      onChange={(e) =>
                        set("revenueMaxInr", e.target.value === "" ? null : Number(e.target.value))
                      }
                      aria-label="Maximum revenue"
                    />
                  </div>
                </Field>
              </div>

              <TagInput
                label="Technologies they run"
                hint="Overlap raises the fit score. Useful when what you sell replaces or integrates with something specific."
                values={form.technologies}
                onChange={(v) => set("technologies", v)}
                suggestions={facets.technologies}
                placeholder="SAP ECC"
              />
            </div>
          </div>

          <Separator />

          <div>
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted">
              Who you talk to — these affect the authority score
            </p>
            <div className="space-y-3">
              <TagInput
                label="Buyer roles"
                values={form.buyerRoles}
                onChange={(v) => set("buyerRoles", v)}
                placeholder="Head of IT"
              />
              <TagInput
                label="Seniority"
                values={form.seniorities}
                onChange={(v) => set("seniorities", v)}
                suggestions={SENIORITY_OPTIONS}
                placeholder="director"
              />
            </div>
          </div>

          <Separator />

          <div>
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted">
              Timing — these drive the urgency score
            </p>
            <div className="space-y-3">
              <TagInput
                label="Trigger events"
                hint="Language in a signal that indicates a live project. The strongest single lever on urgency."
                values={form.triggerEvents}
                onChange={(v) => set("triggerEvents", v)}
                placeholder="erp modernisation"
              />
              <TagInput
                label="Pains you solve"
                hint="Recorded for AI grounding. Not currently matched against signals."
                values={form.pains}
                onChange={(v) => set("pains", v)}
                placeholder="month-end close delays"
              />
            </div>
          </div>

          <Separator />

          <div>
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted">
              Exclusions
            </p>
            <TagInput
              label="Never target"
              hint="A match here subtracts heavily from fit. Use it for segments you genuinely cannot serve."
              values={form.exclusions}
              onChange={(v) => set("exclusions", v)}
              tone="danger"
              placeholder="staffing"
            />
          </div>

          {noCriteria ? (
            <p className="flex items-start gap-1.5 rounded-md border border-warning-border bg-warning-subtle px-2.5 py-2 text-2xs leading-relaxed text-warning-text">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              No firm attributes are set, so every company would match equally and fit would carry
              no information. Add at least an industry or a headcount band.
            </p>
          ) : null}

          <Separator />

          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-sunken px-3 py-2">
            <div>
              <Label htmlFor="icp-primary">Primary profile</Label>
              <p className="mt-0.5 text-2xs text-muted">
                New leads score against this one unless another is chosen.
              </p>
            </div>
            <Switch
              id="icp-primary"
              checked={form.isPrimary || Boolean(isFirst)}
              disabled={Boolean(isFirst)}
              onCheckedChange={(c) => set("isPrimary", c)}
            />
          </div>
        </CardContent>

        <CardFooter className="flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              disabled={!form.name.trim() || rangeInvalid || !dirty}
              onClick={save}
            >
              {profileId ? "Save changes" : "Create profile"}
            </Button>
            <Button variant="secondary" size="sm" loading={previewing} onClick={runPreview}>
              <Target />
              Preview matches
            </Button>
            {onCancel ? (
              <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
            ) : null}
          </div>

          {profileId ? (
            <Tooltip content={deleteBlockedReason}>
              <Button
                variant="danger-ghost"
                size="sm"
                disabled={!canDelete}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 />
                Delete
              </Button>
            </Tooltip>
          ) : null}
        </CardFooter>
      </Card>

      {/* Match preview */}
      {preview ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>What this matches today</CardTitle>
              <p className="mt-0.5 text-2xs text-muted">
                {preview.matching} of {preview.total} leads already in this workspace
              </p>
            </div>
            <Badge
              variant={
                preview.matching === 0 ? "danger" : preview.matching < 5 ? "warning" : "success"
              }
              size="lg"
            >
              {preview.total > 0 ? Math.round((preview.matching / preview.total) * 100) : 0}%
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {preview.matching === 0 ? (
              <p className="rounded-md border border-warning-border bg-warning-subtle px-2.5 py-2 text-xs leading-relaxed text-warning-text">
                Nothing in your current data matches this. That may be right if you are defining a
                new segment — but if you expected matches, the headcount band or the industry
                spelling is the usual culprit.
              </p>
            ) : (
              <ul className="space-y-1">
                {preview.sample.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface px-2.5 py-1.5"
                  >
                    <span className="min-w-0">
                      <Link
                        href={`/leads/${l.id}`}
                        className="block truncate text-xs font-medium text-primary hover:text-brand-text"
                      >
                        {l.name}
                      </Link>
                      <span className="block truncate text-2xs text-muted">{l.company}</span>
                    </span>
                    {l.score !== null ? (
                      <span className="shrink-0 text-xs font-semibold text-secondary tabular">
                        {l.score}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-2xs leading-relaxed text-muted">{preview.note}</p>
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={confirmDelete} onOpenChange={(o) => !deleting && setConfirmDelete(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this profile?</DialogTitle>
            <DialogDescription>
              It moves to the recycle bin and can be restored. No lead currently scores against it.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-xs text-secondary">
              <strong>{form.name}</strong>
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" loading={deleting} onClick={remove}>
              Delete profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
