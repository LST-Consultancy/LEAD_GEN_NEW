import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { CHANGELOG } from "@/lib/changelog";
import { WhatsNewView } from "@/components/admin/whats-new-view";

export const metadata: Metadata = { title: "What's New" };

export default async function WhatsNewPage() {
  await requireAuth();
  return <WhatsNewView entries={CHANGELOG} />;
}
