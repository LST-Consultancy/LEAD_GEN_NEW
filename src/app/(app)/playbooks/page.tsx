import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listPlaybooks } from "@/lib/services/playbooks";
import { PlaybooksView } from "@/components/ai/playbooks-view";

export const metadata: Metadata = { title: "Playbooks" };

export default async function PlaybooksPage() {
  const ctx = await requireAuth();
  const playbooks = await listPlaybooks(ctx);

  return (
    <PlaybooksView
      playbooks={playbooks}
      canManage={ctx.permissions.includes(PERMISSIONS.AGENTS_CONFIGURE)}
    />
  );
}
