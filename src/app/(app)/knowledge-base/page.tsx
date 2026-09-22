import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listKnowledge } from "@/lib/services/knowledge";
import { KnowledgeView } from "@/components/ai/knowledge-view";

export const metadata: Metadata = { title: "Knowledge Base" };

export default async function KnowledgeBasePage() {
  const ctx = await requireAuth();
  // Retired entries are included so the coverage strip can distinguish "never
  // written" from "deliberately withdrawn" — they are not the same gap.
  const { docs, coverage, activeTotal } = await listKnowledge(ctx, { includeInactive: true });

  return (
    <KnowledgeView
      docs={docs}
      coverage={coverage}
      activeTotal={activeTotal}
      canManage={ctx.permissions.includes(PERMISSIONS.KNOWLEDGE_MANAGE)}
    />
  );
}
