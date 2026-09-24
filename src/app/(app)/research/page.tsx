import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { listResearchReports, researchCapability } from "@/lib/services/research";
import { getCapabilities } from "@/lib/services/capabilities";
import { listLeads } from "@/lib/services/leads";
import { leadFilterSchema } from "@/lib/leads/filter";
import { ResearchView } from "@/components/ai/research-view";

export const metadata: Metadata = { title: "Research" };

export default async function ResearchPage() {
  const ctx = await requireAuth();
  const [reports, leadPage, capabilities] = await Promise.all([
    listResearchReports(ctx),
    // The picker searches client-side over what this person can already see,
    // so it never reveals an account their visibility rules exclude.
    listLeads(ctx, leadFilterSchema.parse({ pageSize: 200 })),
    getCapabilities(ctx),
  ]);

  return (
    <ResearchView
      capability={researchCapability(capabilities)}
      reports={reports.map((r) => ({
        id: r.id,
        state: r.state,
        companyName: r.companyName,
        startedAt: r.startedAt,
        confidence: r.confidence,
      }))}
      leads={leadPage.rows.map((l) => ({
        id: l.id,
        companyName: l.company.name,
        personName: l.person.name,
        score: l.score,
      }))}
    />
  );
}
