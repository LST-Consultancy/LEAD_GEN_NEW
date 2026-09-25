"use client";

import * as React from "react";
import Link from "next/link";
import {
  Archive,
  ArrowLeft,
  Building2,
  ExternalLink,
  Globe,
  MapPin,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { IntentBadge, ScoreDial, TierBadge } from "@/components/domain/indicators";
import {
  LeadLifecycleMenu,
  StarToggle,
  StatusMenu,
  RevealButtonSlot,
} from "@/components/leads/dossier/lead-actions";
import { formatAge, formatInrCompact } from "@/lib/format";
import { LeadQuickActions } from "@/components/leads/dossier/quick-actions";
import { EditLeadDetailsButton } from "@/components/leads/dossier/edit-details";
import { ExportLeadButton } from "@/components/leads/dossier/export-lead";
import type { IntentKey, LeadStatusKey, TierKey } from "@/lib/vocab";

export function DossierHeader({
  lead,
  canExport = false,
}: {
  canExport?: boolean;
  lead: {
    id: string;
    status: string;
    tier: string;
    intent: string;
    isStarred: boolean;
    isArchived: boolean;
    lockedContactCount: number;
    estimatedBudgetInr: number | null;
    surfacedAt: string;
    lastActivityAt: string | null;
    person: {
      name: string;
      avatarUrl: string | null;
      linkedinUrl: string | null;
      title: string;
      location: string;
      city?: string | null;
      isDecisionMaker: boolean;
      languages: string[];
    };
    company: {
      id: string;
      name: string;
      website: string | null;
      linkedinUrl: string | null;
      logoUrl: string | null;
      industry: string | null;
      location: string;
      employeeCount: number | null;
      revenueBandInr: string | null;
    };
    owner: { id: string; name: string; avatarUrl: string | null } | null;
    scoring: { displayScore: number } | null;
    deals: { id: string; valueInr: number; stage: { name: string } }[];
    contacts: { kind: string; value: string | null; isLocked: boolean; optedOutAt: string | null }[];
  };
}) {
  const openDeal = lead.deals.find((d) => d.stage.name !== "Won" && d.stage.name !== "Lost");

  return (
    <div className="border-b border-border bg-surface">
      <div className="mx-auto max-w-[1600px] px-3 pt-3 sm:px-4">
        <Button variant="ghost" size="xs" asChild className="mb-2 -ml-1.5">
          <Link href="/leads">
            <ArrowLeft />
            All leads
          </Link>
        </Button>

        <div className="flex flex-wrap items-start gap-3 pb-3">
          <Avatar name={lead.person.name} src={lead.person.avatarUrl} size="2xl" />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="text-xl font-semibold tracking-tight text-primary">
                {lead.person.name}
              </h1>
              <TierBadge tier={lead.tier as TierKey} size="lg" />
              <IntentBadge intent={lead.intent as IntentKey} size="lg" />
              {lead.person.isDecisionMaker ? (
                <Tooltip content="Inferred from their job title. Nobody has confirmed they can sign.">
                  <span className="cursor-help">
                    <Badge variant="brand" uppercase>
                      Likely decision maker
                    </Badge>
                  </span>
                </Tooltip>
              ) : null}
              <EditLeadDetailsButton leadId={lead.id} person={{ name: lead.person.name, title: lead.person.title === "—" ? "" : lead.person.title, linkedinUrl: lead.person.linkedinUrl, city: lead.person.city ?? null }} />
              {lead.isArchived ? (
                <Tooltip content="Auto-archived after a period of inactivity. Still fully searchable.">
                  <Badge variant="outline" uppercase>
                    <Archive />
                    Archived
                  </Badge>
                </Tooltip>
              ) : null}
            </div>

            <p className="mt-1 text-sm text-secondary">
              {lead.person.title} at{" "}
              <Link
                href={`/accounts/${lead.company.id}`}
                className="font-medium hover:text-brand-text"
              >
                {lead.company.name}
              </Link>
            </p>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted">
              {lead.person.location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" />
                  {lead.person.location}
                </span>
              ) : null}
              {lead.company.industry ? (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="size-3" />
                  {lead.company.industry}
                </span>
              ) : null}
              {lead.company.employeeCount ? (
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3" />
                  {lead.company.employeeCount} employees
                </span>
              ) : null}
              {lead.person.languages.length > 0 ? (
                <Tooltip content="Languages recorded for this person — useful when choosing outreach language.">
                  <span className="cursor-help">{lead.person.languages.join(", ")}</span>
                </Tooltip>
              ) : null}
              <span>Surfaced {formatAge(lead.surfacedAt)}</span>
              {lead.lastActivityAt ? <span>Last activity {formatAge(lead.lastActivityAt)}</span> : null}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {lead.person.linkedinUrl ? (
                <a
                  href={lead.person.linkedinUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-2xs text-secondary transition-colors hover:border-border-strong hover:text-primary"
                >
                  LinkedIn
                  <ExternalLink className="size-2.5" />
                </a>
              ) : null}
              {lead.company.website ? (
                <a
                  href={lead.company.website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-2xs text-secondary transition-colors hover:border-border-strong hover:text-primary"
                >
                  <Globe className="size-2.5" />
                  Website
                </a>
              ) : null}
              {openDeal ? (
                <Link
                  href={`/pipeline?deal=${openDeal.id}`}
                  className="inline-flex items-center gap-1 rounded border border-brand-border bg-brand-subtle px-1.5 py-0.5 text-2xs font-medium text-brand-text"
                >
                  {openDeal.stage.name} · {formatInrCompact(openDeal.valueInr)}
                </Link>
              ) : lead.estimatedBudgetInr ? (
                <Tooltip content="Estimated deal size — not a confirmed budget">
                  <span className="cursor-help rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-2xs text-muted">
                    est. {formatInrCompact(lead.estimatedBudgetInr)}
                  </span>
                </Tooltip>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-start gap-3">
            <div className="flex flex-col items-center gap-0.5">
              <ScoreDial score={lead.scoring?.displayScore ?? 0} size="xl" />
              <a
                href="#why"
                className="text-2xs text-muted underline decoration-dotted underline-offset-2 hover:text-brand-text"
              >
                Why?
              </a>
            </div>

            {lead.owner ? (
              <Tooltip content={`Owned by ${lead.owner.name}`}>
                <div className="flex flex-col items-center gap-0.5">
                  <Avatar name={lead.owner.name} src={lead.owner.avatarUrl} size="md" />
                  <span className="text-2xs text-muted">Owner</span>
                </div>
              </Tooltip>
            ) : null}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-1.5 pb-2.5">
          <LeadQuickActions
            lead={{ id: lead.id, name: lead.person.name, companyName: lead.company.name, contacts: lead.contacts }}
          />

          <RevealButtonSlot leadId={lead.id} lockedContactCount={lead.lockedContactCount} />

          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-2xs uppercase tracking-wider text-muted">Status</span>
            <StatusMenu leadId={lead.id} status={lead.status as LeadStatusKey} />
            <StarToggle leadId={lead.id} initial={lead.isStarred} />
            {canExport ? <ExportLeadButton leadId={lead.id} /> : null}
            <Button variant="ghost" size="sm" asChild><Link href={`/print/leads/${lead.id}`}>Print</Link></Button>
            <Button variant="ghost" size="sm" asChild><a href={`/api/leads/${lead.id}/pdf`} download>PDF</a></Button>
            <LeadLifecycleMenu
              leadId={lead.id}
              leadName={lead.person.name}
              isArchived={lead.isArchived}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
