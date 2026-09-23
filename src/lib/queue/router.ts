import "server-only";
import { runOpportunityAction } from "@/lib/services/opportunity-jobs";
import { discoverOpportunities } from "@/lib/services/opportunity-ingestion";
import { refreshOpportunityWatches } from "@/lib/services/opportunity-watches";
import { JOB, type JobName } from "@/lib/queue/jobs";
import { rescoreWorkspace } from "@/lib/queue/handlers/rescore";
import {
  archiveStaleLeads,
  detectDealRisks,
  purgeRecycleBin,
  rescoreWorklist,
} from "@/lib/queue/handlers/maintenance";
import {
  generateCoachTips,
  generateDailyBriefs,
  refreshNextBestActions,
  sweepNotifications,
} from "@/lib/queue/handlers/insights";
import { deliverWebhook } from "@/lib/queue/handlers/webhooks";
import {
  advanceSequences,
  sendMessage,
  wakeSnoozedConversations,
} from "@/lib/queue/handlers/outreach";
import { auditProposalTotals, expireProposals } from "@/lib/queue/handlers/proposals";

/**
 * Maps a job name to the function that runs it.
 *
 * Every handler must be idempotent: BullMQ can deliver the same job twice after
 * a worker dies mid-flight, so a second run has to be harmless. These are, by
 * being either pure recomputations or guarded by a "already done" check.
 */
export async function runJob(name: JobName, data: Record<string, unknown>): Promise<unknown> {
  const workspaceId = data.workspaceId as string;
  if (!workspaceId) throw new Error(`Job ${name} received no workspaceId`);

  switch (name) {
    case JOB.OPPORTUNITY_ACTION: return runOpportunityAction(workspaceId, data as Parameters<typeof runOpportunityAction>[1]);
    case JOB.OPPORTUNITY_DISCOVERY: return discoverOpportunities(workspaceId, data.searchId as string);
    case JOB.OPPORTUNITY_WATCHES: return refreshOpportunityWatches(workspaceId);
    case JOB.RESCORE_WORKSPACE:
      return rescoreWorkspace(workspaceId);

    case JOB.RESCORE_LEAD:
      return rescoreWorkspace(workspaceId, { leadIds: [data.leadId as string] });

    case JOB.DETECT_DEAL_RISKS:
      return detectDealRisks(workspaceId);

    case JOB.ARCHIVE_STALE_LEADS:
      return archiveStaleLeads(workspaceId);

    case JOB.PURGE_RECYCLE_BIN:
      return purgeRecycleBin(workspaceId);

    case JOB.REFRESH_NEXT_ACTIONS:
      return refreshNextBestActions(workspaceId, data.leadIds as string[] | undefined);

    case JOB.RESCORE_WORKLIST:
      return rescoreWorklist(workspaceId);

    case JOB.SWEEP_NOTIFICATIONS:
      return sweepNotifications(workspaceId);

    case JOB.DELIVER_WEBHOOK:
      return deliverWebhook(workspaceId, data.deliveryId as string);

    case JOB.SEND_MESSAGE:
      return sendMessage(workspaceId, data.messageId as string);

    case JOB.ADVANCE_SEQUENCES:
      return advanceSequences(workspaceId);

    case JOB.WAKE_SNOOZED:
      return wakeSnoozedConversations(workspaceId);

    case JOB.EXPIRE_PROPOSALS:
      return expireProposals(workspaceId);

    case JOB.AUDIT_PROPOSAL_TOTALS:
      return auditProposalTotals(workspaceId);

    case JOB.GENERATE_COACH_TIPS:
      return generateCoachTips(workspaceId);

    case JOB.GENERATE_DAILY_BRIEFS:
      return generateDailyBriefs(workspaceId);

    default: {
      // Exhaustiveness: adding a job name without a handler is a type error.
      const unreachable: never = name;
      throw new Error(`No handler registered for job ${String(unreachable)}`);
    }
  }
}
