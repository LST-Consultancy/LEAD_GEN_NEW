import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/context";
import { getLeadDossier } from "@/lib/services/lead-detail";
import { DossierHeader } from "@/components/leads/dossier/header";
import { AiVerdict, ReadinessChecklist, FitRadarPanel } from "@/components/leads/dossier/verdict";
import { ScoreExplainer } from "@/components/leads/dossier/score-explainer";
import { SignalTimeline } from "@/components/leads/dossier/timeline";
import { ContactPanel, ReachableColleagues } from "@/components/leads/dossier/contacts";
import {
  CompanyPanel,
  DealsPanel,
  NextBestActions,
  RelationshipMemory,
  TasksAndNotes,
} from "@/components/leads/dossier/side-panels";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const ctx = await requireAuth();
  const lead = await getLeadDossier(ctx, (await params).id);
  if (!lead) return { title: "Lead not found" };
  return { title: `${lead.person.name} · ${lead.company.name}` };
}

export default async function LeadDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireAuth();
  const lead = await getLeadDossier(ctx, (await params).id);

  // A lead outside the tenant and a lead outside the caller's visibility are
  // deliberately indistinguishable from here.
  if (!lead) notFound();

  const radarDimensions = (lead.scoring?.dimensions ?? []).filter((d) =>
    ["fit", "intent", "urgency", "authority", "budget", "reachability"].includes(d.key)
  );

  return (
    <div>
      <DossierHeader lead={lead} />

      <div className="mx-auto max-w-[1600px] px-3 py-3 sm:px-4 sm:py-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          {/* Main column: verdict, evidence, timeline */}
          <div className="min-w-0 space-y-3">
            <AiVerdict
              score={lead.scoring?.displayScore ?? 0}
              tier={lead.tier}
              intent={lead.intent}
              dimensions={lead.scoring?.dimensions ?? []}
              readiness={lead.readiness}
              signalCount={lead.signals.length}
              latestSignalAt={lead.signals[0]?.occurredAt ?? null}
              estimatedBudgetInr={lead.estimatedBudgetInr}
              surfacedReason={lead.surfacedReason}
              hasReplied={lead.repliedAt !== null}
              isDecisionMaker={lead.person.isDecisionMaker}
            />

            <div className="grid gap-3 md:grid-cols-2">
              <FitRadarPanel dimensions={radarDimensions} />
              <ReadinessChecklist items={lead.readiness} />
            </div>

            {lead.scoring ? (
              <ScoreExplainer
                leadId={lead.id}
                displayScore={lead.scoring.displayScore}
                rawScore={lead.scoring.rawScore}
                composite={lead.scoring.composite}
                isOverridden={lead.scoring.isOverridden}
                overrideReason={lead.scoring.overrideReason}
                computedAt={lead.scoring.computedAt}
                modelVersion={lead.scoring.modelVersion}
                dimensions={lead.scoring.dimensions}
              />
            ) : null}

            <SignalTimeline signals={lead.signals} activities={lead.activities} />

            <div className="grid gap-3 md:grid-cols-2">
              <ContactPanel
                contacts={lead.contacts}
                leadName={lead.person.name}
                leadId={lead.id}
              />
              <ReachableColleagues
                colleagues={lead.colleagues}
                companyName={lead.company.name}
              />
            </div>
          </div>

          {/* Side column: actions, deals, work, account */}
          <div className="min-w-0 space-y-3">
            <NextBestActions actions={lead.nextBestActions} />
            <DealsPanel deals={lead.deals} />
            <TasksAndNotes tasks={lead.tasks} notes={lead.notes} leadId={lead.id} />
            <RelationshipMemory memory={lead.person.memory} />
            <CompanyPanel
              company={lead.company}
              sourcePhrase={lead.sourcePhrase}
              icpProfile={lead.icpProfile}
              lists={lead.lists}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
