import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { listAccounts } from "@/lib/services/people";
import { AccountsView } from "@/components/intelligence/accounts-view";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const ctx = await requireAuth();
  return <AccountsView accounts={await listAccounts(ctx)} />;
}
