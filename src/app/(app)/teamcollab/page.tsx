import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { listStickyNotes } from "@/lib/services/teamcollab";
import { TeamCollabView } from "@/components/admin/teamcollab-view";

export const metadata: Metadata = { title: "TeamCollab" };

export default async function TeamCollabPage() {
  const ctx = await requireAuth();
  return <TeamCollabView notes={await listStickyNotes(ctx)} />;
}
