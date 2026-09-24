import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth/context";
import { getAccount } from "@/lib/services/people";
import { AccountDetail } from "@/components/intelligence/accounts-view";
import { formatInrCompact, formatNumber } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const ctx = await requireAuth();
  const account = await getAccount(ctx, (await params).id);
  return { title: account?.name ?? "Account not found" };
}

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  // Outside the workspace and nonexistent are deliberately the same 404.
  const account = await getAccount(ctx, (await params).id);
  if (!account) notFound();

  const facts = [
    account.domain,
    account.industry,
    [account.city, account.state].filter(Boolean).join(", ") || null,
    account.employeeCount ? `${formatNumber(account.employeeCount)} staff` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <Link href="/accounts" className="inline-flex w-fit items-center gap-1 text-xs text-secondary hover:text-primary">
        <ArrowLeft className="size-3" />
        All accounts
      </Link>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-primary">{account.name}</h1>
          {facts.length ? <p className="mt-0.5 text-xs text-secondary">{facts.join(" · ")}</p> : null}
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <p className="text-2xs text-muted">Intent</p>
            <p className="text-sm font-semibold tabular text-primary">{account.intentScore}</p>
          </div>
          <div>
            <p className="text-2xs text-muted">Open deals</p>
            <p className="text-sm font-semibold tabular text-primary">{formatInrCompact(account.openValueInr)}</p>
          </div>
          <div>
            <p className="text-2xs text-muted">Won</p>
            <p className="text-sm font-semibold tabular text-primary">{formatInrCompact(account.wonValueInr)}</p>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <AccountDetail account={account} />
      </div>
    </div>
  );
}
