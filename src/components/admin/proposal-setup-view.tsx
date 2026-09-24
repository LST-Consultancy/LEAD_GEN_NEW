"use client";

import Link from "next/link";
import { FileText, Info, Percent } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatAge, formatNumber, formatPercent } from "@/lib/format";
import type { ProposalNorms } from "@/lib/services/proposal-setup";
import { ProposalDefaultsForm, type DefaultsValue } from "@/components/admin/proposal-defaults-form";

/**
 * §60 — proposal setup.
 *
 * Reports what proposals actually use rather than offering defaults that
 * nothing reads. The inconsistency panel is the valuable part: two different
 * tax rates in use is a real problem that a settings screen with one input box
 * would have hidden.
 */
export function ProposalSetupView({ norms, defaults, canEdit }: { norms: ProposalNorms; defaults: DefaultsValue; canEdit: boolean }) {
  const mixedRates = norms.taxRates.length > 1;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Proposal Setup</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          New proposals start from the defaults below; each one then keeps its own tax rate,
          terms and validity. The report underneath shows what your proposals actually use.
        </p>
      </div>

      <ProposalDefaultsForm initial={defaults} canEdit={canEdit} />

      {norms.total === 0 ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState
              icon={FileText}
              title="No proposals yet"
              description="Once you send one, this will report the tax rate, terms and validity your proposals actually use — and flag any that disagree with each other."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-1.5">
              <Percent className="size-3.5 text-muted" />
              What your proposals use
            </CardTitle>
            <span className="text-2xs text-muted">
              across {formatNumber(norms.total)} {norms.total === 1 ? "proposal" : "proposals"}
            </span>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div>
              <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">
                Tax rate
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {norms.taxRates.map((r) => (
                  <Badge key={r.rate} variant={mixedRates ? "warning" : "neutral"} size="sm">
                    {formatPercent(r.rate)} — {formatNumber(r.count)}
                  </Badge>
                ))}
              </div>
              {mixedRates ? (
                <p className="mt-1 text-2xs leading-relaxed text-warning-text">
                  More than one rate is in use. That is either deliberate — inter-state versus
                  intra-state supply, or an exempt line — or a mistake worth finding before the next
                  invoice.
                </p>
              ) : (
                <p className="mt-1 text-2xs leading-relaxed text-muted">
                  Consistent across every proposal.
                </p>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-border bg-surface p-2.5">
                <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                  Carry terms
                </p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-primary">
                  {formatNumber(norms.withTerms)} of {formatNumber(norms.total)}
                </p>
                <p className="mt-1 text-2xs leading-relaxed text-muted">
                  A proposal with no terms block is one you cannot point back at later.
                </p>
              </div>
              <div className="rounded-md border border-border bg-surface p-2.5">
                <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                  Typical validity
                </p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-primary">
                  {norms.medianValidityDays === null
                    ? "—"
                    : `${norms.medianValidityDays} days`}
                </p>
                <p className="mt-1 text-2xs leading-relaxed text-muted">
                  {norms.medianValidityDays === null
                    ? "No proposal sets an expiry, so none of them create urgency."
                    : `Median, not mean — one left open for a year shouldn't move it.${
                        norms.withoutValidity > 0
                          ? ` ${formatNumber(norms.withoutValidity)} have no expiry at all.`
                          : ""
                      }`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <FileText className="size-3.5 text-muted" />
            Where your commercial terms really live
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {norms.pricingDocs.length === 0 ? (
            <p className="text-2xs leading-relaxed text-muted">
              No pricing entry is written in the{" "}
              <Link
                href="/knowledge-base"
                className="text-brand-text underline-offset-2 hover:underline"
              >
                Knowledge Base
              </Link>
              . That is the entry that stops a generated draft inventing a discount or a payment
              term you never offered — worth writing before drafting is wired to a model.
            </p>
          ) : (
            <>
              <p className="mb-2 text-2xs leading-relaxed text-muted">
                These bound what any generated proposal may claim about price and terms.
              </p>
              <div className="space-y-1">
                {norms.pricingDocs.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 text-2xs">
                    <Link
                      href="/knowledge-base"
                      className="text-brand-text underline-offset-2 hover:underline"
                    >
                      {d.title}
                    </Link>
                    <span className="text-muted">updated {formatAge(d.updatedAt)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-2xs leading-relaxed text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        Money on a proposal is computed in integer paise and each line is rounded once, so the
        subtotal always equals the sum of the figures printed beside the lines. A mismatch is
        reported and never silently corrected — a price the customer has seen does not change
        without someone deciding to change it.
      </p>
    </div>
  );
}
