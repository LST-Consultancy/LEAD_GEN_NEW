"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { formatDate } from "@/lib/format";

type Workspace = {
  name: string;
  slug: string;
  website: string | null;
  industry: string | null;
  gstin: string | null;
  country: string;
  currency: string;
  timezone: string;
  locale: string;
  createdAt: string;
};

/**
 * §78 — the workspace profile.
 *
 * The GSTIN is the field that matters commercially: it is what puts a valid tax
 * line on a proposal, so it is validated to the real 15-character format rather
 * than accepted as free text and discovered wrong at invoicing.
 */
export function WorkspaceSettingsView({
  workspace,
  canManage,
}: {
  workspace: Workspace;
  canManage: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = React.useState({
    name: workspace.name,
    website: workspace.website ?? "",
    industry: workspace.industry ?? "",
    gstin: workspace.gstin ?? "",
    timezone: workspace.timezone,
    currency: workspace.currency,
    locale: workspace.locale,
  });
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dirty =
    form.name !== workspace.name ||
    form.website !== (workspace.website ?? "") ||
    form.industry !== (workspace.industry ?? "") ||
    form.gstin !== (workspace.gstin ?? "") ||
    form.timezone !== workspace.timezone ||
    form.currency !== workspace.currency ||
    form.locale !== workspace.locale;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.put("/api/workspace/settings", form);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That couldn't be saved. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Workspace</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          How this workspace identifies itself, and the regional defaults every date, number and
          money figure in the product is formatted with.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Building2 className="size-3.5 text-muted" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <Field
            id="ws-name"
            label="Name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            disabled={!canManage}
            hint="Shown in the workspace switcher and on anything you send."
          />
          <Field
            id="ws-website"
            label="Website"
            value={form.website}
            onChange={(v) => setForm({ ...form, website: v })}
            disabled={!canManage}
            placeholder="https://example.com"
            hint="Used as the sender identity's home page. Leave blank to clear."
          />
          <Field
            id="ws-industry"
            label="Industry"
            value={form.industry}
            onChange={(v) => setForm({ ...form, industry: v })}
            disabled={!canManage}
            hint="What you sell, not who you sell to — your ICP covers the latter."
          />
          <Field
            id="ws-gstin"
            label="GSTIN"
            value={form.gstin}
            onChange={(v) => setForm({ ...form, gstin: v.toUpperCase() })}
            disabled={!canManage}
            placeholder="27AAAAA0000A1Z5"
            mono
            hint="15 characters. This is what puts a valid tax line on a proposal, so it is checked against the real format rather than accepted as free text."
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              id="ws-tz"
              label="Timezone"
              value={form.timezone}
              onChange={(v) => setForm({ ...form, timezone: v })}
              disabled={!canManage}
              hint="Send windows and 'today' are computed in this zone."
            />
            <Field
              id="ws-currency"
              label="Currency"
              value={form.currency}
              onChange={(v) => setForm({ ...form, currency: v.toUpperCase() })}
              disabled={!canManage}
              mono
              hint="Three-letter code. Existing figures are not converted."
            />
            <Field
              id="ws-locale"
              label="Locale"
              value={form.locale}
              onChange={(v) => setForm({ ...form, locale: v })}
              disabled={!canManage}
              mono
              hint="en-IN gives lakh and crore grouping."
            />
          </div>

          {error ? (
            <p className="rounded-md border border-danger-border bg-danger-subtle p-2 text-2xs text-danger-text">
              {error}
            </p>
          ) : null}

          {canManage ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !dirty}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save changes"}
              </Button>
              {saved && !dirty ? (
                <span className="flex items-center gap-1 text-2xs text-success-text">
                  <Check className="size-3" />
                  Saved
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-2xs text-muted">
              You don&apos;t have permission to change these. Ask an owner or admin.
            </p>
          )}
        </CardContent>
      </Card>

      <p className="text-2xs leading-relaxed text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        Workspace <span className="font-mono">{workspace.slug}</span>, in {workspace.country},
        created {formatDate(workspace.createdAt)}. Changing the currency does not convert figures
        already recorded — it changes how new ones are formatted.
      </p>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  hint,
  placeholder,
  disabled,
  mono,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted"
      >
        {label}
      </label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={mono ? "font-mono" : undefined}
      />
      {hint ? <p className="mt-1 text-2xs leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}
