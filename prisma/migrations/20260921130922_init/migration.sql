-- CreateEnum
CREATE TYPE "IcpTier" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "IntentLevel" AS ENUM ('COLD', 'AWARE', 'WARM', 'HOT', 'BUYING');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'WORKING', 'CONTACTED', 'REPLIED', 'QUALIFIED', 'NURTURE', 'UNQUALIFIED');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('SOCIAL_POST', 'SOCIAL_COMMENT', 'HIRING', 'JOB_CHANGE', 'FUNDING', 'TECH_CHANGE', 'WEBSITE_UPDATE', 'ANNOUNCEMENT', 'NEWS', 'RFP', 'EVENT', 'REVIEW', 'COMPETITOR_MENTION', 'EMAIL_ACTIVITY', 'PROPOSAL_ACTIVITY', 'MEETING', 'MANUAL_NOTE');

-- CreateEnum
CREATE TYPE "SignalSourceKind" AS ENUM ('PUBLIC_WEB', 'JOB_BOARD', 'NEWS', 'SOCIAL_PUBLIC', 'COMPANY_SITE', 'LICENSED_DATASET', 'USER_INTEGRATION', 'USER_MANUAL', 'TENDER_PORTAL');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'WHATSAPP', 'LINKEDIN', 'PHONE', 'SMS', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('WORK_EMAIL', 'PERSONAL_EMAIL', 'DIRECT_PHONE', 'MOBILE', 'SWITCHBOARD', 'LINKEDIN_URL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED', 'LIKELY', 'UNVERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('QUEUED', 'WORKING', 'NEEDS_ATTENTION', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "PointTxnType" AS ENUM ('PURCHASE', 'PLAN_ALLOCATION', 'REVEAL', 'RESEARCH', 'ENRICHMENT', 'VOICE_NOTE', 'REFUND', 'ADMIN_ADJUSTMENT', 'EXPIRY');

-- CreateEnum
CREATE TYPE "AutopilotMode" AS ENUM ('OFF', 'REVIEW_FIRST', 'FULL_AUTO');

-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('PROSPECTING', 'RESEARCH', 'SDR', 'FOLLOW_UP', 'PIPELINE', 'PROPOSAL', 'MEETING', 'REVENUE_ANALYST');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('HUMAN', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('UI', 'API', 'MCP', 'AUTOPILOT', 'INTEGRATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageState" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'REPLIED', 'BOUNCED', 'FAILED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "ConversationState" AS ENUM ('OPEN', 'NEEDS_YOU', 'WAITING', 'SNOOZED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProposalState" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('HOT_LEAD', 'NEW_REPLY', 'LEAD_SIGNAL', 'DEAL_RISK', 'TASK_DUE', 'PROPOSAL_VIEWED', 'MEETING_BOOKED', 'AUTOPILOT_APPROVAL', 'POINTS_LOW', 'INTEGRATION_ERROR');

-- CreateEnum
CREATE TYPE "InsightKind" AS ENUM ('DAILY_BRIEF', 'COACH_TIP', 'DEAL_RISK', 'LEAD_RECOMMENDATION', 'QUERY_OPTIMIZATION', 'FORECAST_NOTE');

-- CreateEnum
CREATE TYPE "RunState" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'HELD_FOR_REVIEW');

-- CreateEnum
CREATE TYPE "StickyNoteKind" AS ENUM ('IDEA', 'REMINDER', 'OBJECTION', 'FOLLOW_UP', 'PERSONAL');

-- CreateEnum
CREATE TYPE "WatchTargetKind" AS ENUM ('LEAD', 'COMPANY', 'COMPETITOR', 'KEYWORD', 'TECHNOLOGY', 'INDUSTRY');

-- CreateEnum
CREATE TYPE "AlertFrequency" AS ENUM ('REALTIME', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "RadarStage" AS ENUM ('AWARE', 'EVALUATING', 'READY_TO_BUY');

-- CreateEnum
CREATE TYPE "CommitteeRole" AS ENUM ('CHAMPION', 'DECISION_MAKER', 'INFLUENCER', 'TECHNICAL_EVALUATOR', 'FINANCE', 'PROCUREMENT', 'BLOCKER', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "workspaceId" UUID,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "gstin" TEXT,
    "autopilotMode" "AutopilotMode" NOT NULL DEFAULT 'OFF',
    "onboardedAt" TIMESTAMP(3),
    "archiveAfterDays" INTEGER NOT NULL DEFAULT 45,
    "recycleBinDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "title" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "dailyPointCap" INTEGER,
    "invitedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthly" DECIMAL(12,2) NOT NULL,
    "priceYearly" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "seatsIncluded" INTEGER NOT NULL DEFAULT 1,
    "pointsMonthly" INTEGER NOT NULL DEFAULT 0,
    "features" JSONB NOT NULL DEFAULT '{}',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "seats" INTEGER NOT NULL DEFAULT 1,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointLedger" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "type" "PointTxnType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'HUMAN',
    "actorUserId" UUID,
    "refType" TEXT,
    "refId" TEXT,
    "idempotencyKey" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IcpProfile" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sellsDescription" TEXT,
    "industries" TEXT[],
    "locations" TEXT[],
    "employeeMin" INTEGER,
    "employeeMax" INTEGER,
    "revenueMinInr" DECIMAL(14,2),
    "revenueMaxInr" DECIMAL(14,2),
    "buyerRoles" TEXT[],
    "seniorities" TEXT[],
    "technologies" TEXT[],
    "pains" TEXT[],
    "triggerEvents" TEXT[],
    "exclusions" TEXT[],
    "rules" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IcpProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringConfig" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "fitWeight" INTEGER NOT NULL DEFAULT 25,
    "intentWeight" INTEGER NOT NULL DEFAULT 25,
    "urgencyWeight" INTEGER NOT NULL DEFAULT 15,
    "authorityWeight" INTEGER NOT NULL DEFAULT 10,
    "budgetWeight" INTEGER NOT NULL DEFAULT 10,
    "reachabilityWeight" INTEGER NOT NULL DEFAULT 5,
    "engagementWeight" INTEGER NOT NULL DEFAULT 5,
    "recencyWeight" INTEGER NOT NULL DEFAULT 5,
    "tierACutoff" INTEGER NOT NULL DEFAULT 80,
    "tierBCutoff" INTEGER NOT NULL DEFAULT 60,
    "tierCCutoff" INTEGER NOT NULL DEFAULT 40,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoringConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "domain" TEXT,
    "website" TEXT,
    "linkedinUrl" TEXT,
    "logoUrl" TEXT,
    "description" TEXT,
    "industry" TEXT,
    "subIndustry" TEXT,
    "employeeCount" INTEGER,
    "employeeBand" TEXT,
    "revenueBandInr" TEXT,
    "foundedYear" INTEGER,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "technologies" TEXT[],
    "tags" TEXT[],
    "intentScore" INTEGER NOT NULL DEFAULT 0,
    "intentScoreReason" JSONB NOT NULL DEFAULT '{}',
    "lastSignalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "headline" TEXT,
    "linkedinUrl" TEXT,
    "avatarUrl" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "languages" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employment" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT,
    "seniority" TEXT,
    "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMethod" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "kind" "ContactKind" NOT NULL,
    "value" TEXT,
    "maskedValue" TEXT NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "source" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "revealedAt" TIMESTAMP(3),
    "revealedByUserId" UUID,
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipMemory" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 70,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RelationshipMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "icpProfileId" UUID,
    "ownerId" UUID,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "tier" "IcpTier" NOT NULL DEFAULT 'C',
    "intent" "IntentLevel" NOT NULL DEFAULT 'COLD',
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "isRevealed" BOOLEAN NOT NULL DEFAULT false,
    "estimatedBudgetInr" DECIMAL(14,2),
    "surfacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "surfacedReason" TEXT NOT NULL,
    "sourcePhraseId" UUID,
    "lastContactedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "nextActionAt" TIMESTAMP(3),
    "nextActionLabel" TEXT,
    "archivedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "discardReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadScore" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "fitScore" INTEGER NOT NULL DEFAULT 0,
    "intentScore" INTEGER NOT NULL DEFAULT 0,
    "urgencyScore" INTEGER NOT NULL DEFAULT 0,
    "authorityScore" INTEGER NOT NULL DEFAULT 0,
    "budgetScore" INTEGER NOT NULL DEFAULT 0,
    "reachabilityScore" INTEGER NOT NULL DEFAULT 0,
    "engagementScore" INTEGER NOT NULL DEFAULT 0,
    "recencyScore" INTEGER NOT NULL DEFAULT 0,
    "composite" INTEGER NOT NULL DEFAULT 0,
    "displayScore" DECIMAL(3,1) NOT NULL DEFAULT 0,
    "overriddenScore" DECIMAL(3,1),
    "overriddenById" UUID,
    "overrideReason" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelVersion" TEXT NOT NULL DEFAULT 'v1',

    CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadScoreEvidence" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadScoreId" UUID NOT NULL,
    "dimension" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "detail" TEXT,
    "signalId" UUID,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScoreEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID,
    "personId" UUID,
    "companyId" UUID,
    "type" "SignalType" NOT NULL,
    "sourceKind" "SignalSourceKind" NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "aiInterpretation" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 60,
    "intentDelta" INTEGER NOT NULL DEFAULT 0,
    "suggestedAction" TEXT,
    "keywords" TEXT[],
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "searchPhraseId" UUID,
    "dedupeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchPhrase" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "phrase" TEXT NOT NULL,
    "sourceKind" "SignalSourceKind" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "cadenceHours" INTEGER NOT NULL DEFAULT 24,
    "negativeKeywords" TEXT[],
    "createdByAi" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SearchPhrase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRun" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "searchPhraseId" UUID NOT NULL,
    "state" "RunState" NOT NULL DEFAULT 'PENDING',
    "signalsFound" INTEGER NOT NULL DEFAULT 0,
    "leadsCreated" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,

    CONSTRAINT "SearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "List" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDynamic" BOOLEAN NOT NULL DEFAULT false,
    "filterJson" JSONB NOT NULL DEFAULT '{}',
    "color" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "List_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListMember" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "listId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" UUID,

    CONSTRAINT "ListMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarWatch" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "targetKind" "WatchTargetKind" NOT NULL,
    "targetId" TEXT,
    "targetLabel" TEXT NOT NULL,
    "frequency" "AlertFrequency" NOT NULL DEFAULT 'DAILY',
    "alertOn" TEXT[],
    "stage" "RadarStage" NOT NULL DEFAULT 'AWARE',
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "lastAlertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RadarWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "filterJson" JSONB NOT NULL DEFAULT '{}',
    "alertEnabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "AlertFrequency" NOT NULL DEFAULT 'DAILY',
    "createdById" UUID,
    "lastAlertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "stallAfterDays" INTEGER NOT NULL DEFAULT 10,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "leadId" UUID,
    "companyId" UUID NOT NULL,
    "ownerId" UUID,
    "title" TEXT NOT NULL,
    "valueInr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "repForecast" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "expectedCloseAt" TIMESTAMP(3),
    "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3),
    "nextActionAt" TIMESTAMP(3),
    "nextActionLabel" TEXT,
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealStageHistory" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "fromStageId" UUID,
    "toStageId" UUID NOT NULL,
    "valueAtMove" DECIMAL(14,2) NOT NULL,
    "daysInStage" INTEGER NOT NULL DEFAULT 0,
    "actorType" "ActorType" NOT NULL DEFAULT 'HUMAN',
    "actorUserId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealRisk" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "suggestedAction" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealRisk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyEntry" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amountInr" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "dueAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "ownerId" UUID,
    "leadId" UUID,
    "companyId" UUID,
    "dealId" UUID,
    "proposalId" UUID,
    "bookingId" UUID,
    "channel" "Channel",
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "priorityScore" INTEGER NOT NULL DEFAULT 0,
    "priorityReason" TEXT,
    "expectedImpactInr" DECIMAL(14,2),
    "recommendedAction" TEXT,
    "createdByAi" BOOLEAN NOT NULL DEFAULT false,
    "lane" TEXT NOT NULL DEFAULT 'QUEUED',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "revenueImpact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'collaborator',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "prerequisiteId" UUID NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" UUID,
    "leadId" UUID,
    "companyId" UUID,
    "dealId" UUID,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StickyNote" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "kind" "StickyNoteKind" NOT NULL DEFAULT 'IDEA',
    "body" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'amber',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "leadId" UUID,
    "companyId" UUID,
    "dealId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StickyNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "actorType" "ActorType" NOT NULL DEFAULT 'HUMAN',
    "actorUserId" UUID,
    "actorAgentId" UUID,
    "leadId" UUID,
    "companyId" UUID,
    "dealId" UUID,
    "channel" "Channel",
    "amountInr" DECIMAL(14,2),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "subject" TEXT,
    "state" "ConversationState" NOT NULL DEFAULT 'OPEN',
    "leadId" UUID,
    "companyId" UUID,
    "dealId" UUID,
    "assigneeId" UUID,
    "isUnread" BOOLEAN NOT NULL DEFAULT false,
    "aiSummary" TEXT,
    "sentiment" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snoozedUntil" TIMESTAMP(3),
    "externalThreadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "channel" "Channel" NOT NULL,
    "state" "MessageState" NOT NULL DEFAULT 'DRAFT',
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "actorType" "ActorType" NOT NULL DEFAULT 'HUMAN',
    "actorUserId" UUID,
    "generatedByAi" BOOLEAN NOT NULL DEFAULT false,
    "aiModel" TEXT,
    "sequenceStepId" UUID,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "externalId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "stopOnUnsubscribe" BOOLEAN NOT NULL DEFAULT true,
    "sendWindowStart" INTEGER NOT NULL DEFAULT 9,
    "sendWindowEnd" INTEGER NOT NULL DEFAULT 19,
    "sendDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "dailyCap" INTEGER NOT NULL DEFAULT 50,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sequenceId" UUID NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "channel" "Channel" NOT NULL,
    "isManualTask" BOOLEAN NOT NULL DEFAULT false,
    "subject" TEXT,
    "bodyTemplate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceEnrollment" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sequenceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextSendAt" TIMESTAMP(3),
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "stopReason" TEXT,

    CONSTRAINT "SequenceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID,
    "companyId" UUID NOT NULL,
    "dealId" UUID,
    "title" TEXT NOT NULL,
    "state" "ProposalState" NOT NULL DEFAULT 'DRAFT',
    "publicToken" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotalInr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "taxInr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalInr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "terms" TEXT,
    "validUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "firstViewedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "createdById" UUID,
    "generatedByAi" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalItem" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'item',
    "unitPriceInr" DECIMAL(14,2) NOT NULL,
    "amountInr" DECIMAL(14,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProposalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalView" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationSec" INTEGER,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "city" TEXT,

    CONSTRAINT "ProposalView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID,
    "dealId" UUID,
    "hostUserId" UUID,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'scheduled',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "location" TEXT,
    "meetingUrl" TEXT,
    "provider" TEXT,
    "externalId" TEXT,
    "agenda" TEXT,
    "briefJson" JSONB NOT NULL DEFAULT '{}',
    "transcript" TEXT,
    "aiSummary" TEXT,
    "outcomes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommitteeMember" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "role" "CommitteeRole" NOT NULL DEFAULT 'UNKNOWN',
    "isAiSuggested" BOOLEAN NOT NULL DEFAULT true,
    "confirmedAt" TIMESTAMP(3),
    "influence" INTEGER NOT NULL DEFAULT 50,
    "sentiment" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommitteeMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "aliases" TEXT[],
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchReport" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID,
    "personId" UUID,
    "companyId" UUID,
    "depth" TEXT NOT NULL DEFAULT 'deep',
    "state" "RunState" NOT NULL DEFAULT 'PENDING',
    "pointsSpent" INTEGER NOT NULL DEFAULT 0,
    "personSection" JSONB NOT NULL DEFAULT '{}',
    "companySection" JSONB NOT NULL DEFAULT '{}',
    "opportunitySection" JSONB NOT NULL DEFAULT '{}',
    "outreachSection" JSONB NOT NULL DEFAULT '{}',
    "citations" JSONB NOT NULL DEFAULT '[]',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "modelUsed" TEXT,
    "requestedById" UUID,
    "requestedByAgentId" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "ResearchReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInsight" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" "InsightKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "whyNow" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "leadId" UUID,
    "dealId" UUID,
    "forUserId" UUID,
    "modelUsed" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 70,
    "validUntil" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "actedAt" TIMESTAMP(3),
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NextBestAction" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID,
    "dealId" UUID,
    "action" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "channel" "Channel",
    "expectedImpactInr" DECIMAL(14,2),
    "chosenAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "feedback" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NextBestAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadinessItem" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "evidence" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadinessItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAgent" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" "AgentKind" NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "tools" TEXT[],
    "approvalPolicy" TEXT NOT NULL DEFAULT 'review_first',
    "dailyPointBudget" INTEGER NOT NULL DEFAULT 0,
    "dailyActionCap" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AIAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotConfig" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "mode" "AutopilotMode" NOT NULL DEFAULT 'OFF',
    "maxLeadsPerDay" INTEGER NOT NULL DEFAULT 20,
    "maxRevealsPerDay" INTEGER NOT NULL DEFAULT 5,
    "maxPointsPerDay" INTEGER NOT NULL DEFAULT 25,
    "maxEmailsPerDay" INTEGER NOT NULL DEFAULT 30,
    "maxWhatsappPerDay" INTEGER NOT NULL DEFAULT 10,
    "maxLinkedinPerDay" INTEGER NOT NULL DEFAULT 10,
    "allowedTiers" "IcpTier"[] DEFAULT ARRAY['A', 'B']::"IcpTier"[],
    "minScore" INTEGER NOT NULL DEFAULT 70,
    "allowedIndustries" TEXT[],
    "allowedLocations" TEXT[],
    "allowedChannels" "Channel"[] DEFAULT ARRAY['EMAIL']::"Channel"[],
    "sendWindowStart" INTEGER NOT NULL DEFAULT 9,
    "sendWindowEnd" INTEGER NOT NULL DEFAULT 19,
    "sendDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "blockedDomains" TEXT[],
    "blockedCompanies" TEXT[],
    "approvalThresholdInr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "requireApprovalForSpend" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "state" "RunState" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "pointsSpent" INTEGER NOT NULL DEFAULT 0,
    "actionsTaken" INTEGER NOT NULL DEFAULT 0,
    "actionsHeld" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "idempotencyKey" TEXT,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "riskClass" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "state" TEXT NOT NULL DEFAULT 'completed',
    "pointsSpent" INTEGER NOT NULL DEFAULT 0,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "leadId" UUID,
    "dealId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playbook" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerJson" JSONB NOT NULL DEFAULT '{}',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isAgentTriggerable" BOOLEAN NOT NULL DEFAULT false,
    "timesRun" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Playbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[],
    "fileId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIRequestLog" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptKey" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostInr" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorCode" TEXT,
    "actorType" "ActorType" NOT NULL DEFAULT 'HUMAN',
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "href" TEXT,
    "leadId" UUID,
    "dealId" UUID,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'HUMAN',
    "actorUserId" UUID,
    "actorLabel" TEXT NOT NULL,
    "source" "AuditSource" NOT NULL DEFAULT 'UI',
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletedRecord" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "deletedByUserId" UUID,
    "deletedByLabel" TEXT NOT NULL,
    "purgeAfter" TIMESTAMP(3) NOT NULL,
    "restoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastStatus" INTEGER,
    "lastDeliveryAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "webhookId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "statusCode" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdById" UUID,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPct" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_deletedAt_idx" ON "Workspace"("deletedAt");

-- CreateIndex
CREATE INDEX "Role_workspaceId_idx" ON "Role"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_workspaceId_key_key" ON "Role"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_deletedAt_idx" ON "WorkspaceMember"("workspaceId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_workspaceId_key" ON "Subscription"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PointLedger_idempotencyKey_key" ON "PointLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PointLedger_workspaceId_createdAt_idx" ON "PointLedger"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "PointLedger_workspaceId_type_idx" ON "PointLedger"("workspaceId", "type");

-- CreateIndex
CREATE INDEX "IcpProfile_workspaceId_deletedAt_idx" ON "IcpProfile"("workspaceId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringConfig_workspaceId_key" ON "ScoringConfig"("workspaceId");

-- CreateIndex
CREATE INDEX "Company_workspaceId_deletedAt_idx" ON "Company"("workspaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "Company_workspaceId_industry_idx" ON "Company"("workspaceId", "industry");

-- CreateIndex
CREATE INDEX "Company_workspaceId_city_idx" ON "Company"("workspaceId", "city");

-- CreateIndex
CREATE INDEX "Company_workspaceId_intentScore_idx" ON "Company"("workspaceId", "intentScore");

-- CreateIndex
CREATE INDEX "Company_name_idx" ON "Company"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Company_workspaceId_domain_key" ON "Company"("workspaceId", "domain");

-- CreateIndex
CREATE INDEX "Person_workspaceId_deletedAt_idx" ON "Person"("workspaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "Person_workspaceId_linkedinUrl_idx" ON "Person"("workspaceId", "linkedinUrl");

-- CreateIndex
CREATE INDEX "Person_fullName_idx" ON "Person"("fullName");

-- CreateIndex
CREATE INDEX "Employment_workspaceId_idx" ON "Employment"("workspaceId");

-- CreateIndex
CREATE INDEX "Employment_personId_isCurrent_idx" ON "Employment"("personId", "isCurrent");

-- CreateIndex
CREATE INDEX "Employment_companyId_isCurrent_idx" ON "Employment"("companyId", "isCurrent");

-- CreateIndex
CREATE INDEX "ContactMethod_workspaceId_personId_idx" ON "ContactMethod"("workspaceId", "personId");

-- CreateIndex
CREATE INDEX "ContactMethod_workspaceId_kind_idx" ON "ContactMethod"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "ContactMethod_value_idx" ON "ContactMethod"("value");

-- CreateIndex
CREATE INDEX "RelationshipMemory_workspaceId_personId_idx" ON "RelationshipMemory"("workspaceId", "personId");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_deletedAt_archivedAt_idx" ON "Lead"("workspaceId", "deletedAt", "archivedAt");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_status_idx" ON "Lead"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_tier_idx" ON "Lead"("workspaceId", "tier");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_intent_idx" ON "Lead"("workspaceId", "intent");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_ownerId_idx" ON "Lead"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_surfacedAt_idx" ON "Lead"("workspaceId", "surfacedAt");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_isStarred_idx" ON "Lead"("workspaceId", "isStarred");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_lastActivityAt_idx" ON "Lead"("workspaceId", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_workspaceId_personId_companyId_key" ON "Lead"("workspaceId", "personId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadScore_leadId_key" ON "LeadScore"("leadId");

-- CreateIndex
CREATE INDEX "LeadScore_workspaceId_composite_idx" ON "LeadScore"("workspaceId", "composite");

-- CreateIndex
CREATE INDEX "LeadScoreEvidence_leadScoreId_idx" ON "LeadScoreEvidence"("leadScoreId");

-- CreateIndex
CREATE INDEX "LeadScoreEvidence_workspaceId_idx" ON "LeadScoreEvidence"("workspaceId");

-- CreateIndex
CREATE INDEX "Signal_workspaceId_occurredAt_idx" ON "Signal"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "Signal_workspaceId_type_idx" ON "Signal"("workspaceId", "type");

-- CreateIndex
CREATE INDEX "Signal_workspaceId_leadId_idx" ON "Signal"("workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "Signal_workspaceId_companyId_idx" ON "Signal"("workspaceId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_workspaceId_dedupeHash_key" ON "Signal"("workspaceId", "dedupeHash");

-- CreateIndex
CREATE INDEX "SearchPhrase_workspaceId_isActive_idx" ON "SearchPhrase"("workspaceId", "isActive");

-- CreateIndex
CREATE INDEX "SearchPhrase_nextRunAt_idx" ON "SearchPhrase"("nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchRun_idempotencyKey_key" ON "SearchRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SearchRun_workspaceId_startedAt_idx" ON "SearchRun"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "SearchRun_searchPhraseId_startedAt_idx" ON "SearchRun"("searchPhraseId", "startedAt");

-- CreateIndex
CREATE INDEX "List_workspaceId_deletedAt_idx" ON "List"("workspaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "ListMember_workspaceId_idx" ON "ListMember"("workspaceId");

-- CreateIndex
CREATE INDEX "ListMember_leadId_idx" ON "ListMember"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "ListMember_listId_leadId_key" ON "ListMember"("listId", "leadId");

-- CreateIndex
CREATE INDEX "RadarWatch_workspaceId_isActive_idx" ON "RadarWatch"("workspaceId", "isActive");

-- CreateIndex
CREATE INDEX "SavedSearch_workspaceId_surface_idx" ON "SavedSearch"("workspaceId", "surface");

-- CreateIndex
CREATE INDEX "Pipeline_workspaceId_deletedAt_idx" ON "Pipeline"("workspaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "PipelineStage_workspaceId_idx" ON "PipelineStage"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_pipelineId_key_key" ON "PipelineStage"("pipelineId", "key");

-- CreateIndex
CREATE INDEX "Deal_workspaceId_deletedAt_status_idx" ON "Deal"("workspaceId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "Deal_workspaceId_stageId_idx" ON "Deal"("workspaceId", "stageId");

-- CreateIndex
CREATE INDEX "Deal_workspaceId_ownerId_idx" ON "Deal"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "Deal_workspaceId_expectedCloseAt_idx" ON "Deal"("workspaceId", "expectedCloseAt");

-- CreateIndex
CREATE INDEX "Deal_pipelineId_stageId_sortOrder_idx" ON "Deal"("pipelineId", "stageId", "sortOrder");

-- CreateIndex
CREATE INDEX "DealStageHistory_workspaceId_createdAt_idx" ON "DealStageHistory"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "DealStageHistory_dealId_createdAt_idx" ON "DealStageHistory"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "DealRisk_workspaceId_severity_idx" ON "DealRisk"("workspaceId", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "DealRisk_dealId_code_key" ON "DealRisk"("dealId", "code");

-- CreateIndex
CREATE INDEX "MoneyEntry_workspaceId_kind_idx" ON "MoneyEntry"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "MoneyEntry_dealId_idx" ON "MoneyEntry"("dealId");

-- CreateIndex
CREATE INDEX "Task_workspaceId_deletedAt_status_idx" ON "Task"("workspaceId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "Task_workspaceId_ownerId_status_idx" ON "Task"("workspaceId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "Task_workspaceId_dueAt_idx" ON "Task"("workspaceId", "dueAt");

-- CreateIndex
CREATE INDEX "Task_workspaceId_priorityScore_idx" ON "Task"("workspaceId", "priorityScore");

-- CreateIndex
CREATE INDEX "Task_workspaceId_lane_sortOrder_idx" ON "Task"("workspaceId", "lane", "sortOrder");

-- CreateIndex
CREATE INDEX "TaskAssignment_workspaceId_userId_idx" ON "TaskAssignment"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_taskId_userId_key" ON "TaskAssignment"("taskId", "userId");

-- CreateIndex
CREATE INDEX "TaskDependency_workspaceId_idx" ON "TaskDependency"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_taskId_prerequisiteId_key" ON "TaskDependency"("taskId", "prerequisiteId");

-- CreateIndex
CREATE INDEX "Note_workspaceId_leadId_idx" ON "Note"("workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "Note_workspaceId_dealId_idx" ON "Note"("workspaceId", "dealId");

-- CreateIndex
CREATE INDEX "Note_workspaceId_createdAt_idx" ON "Note"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "StickyNote_workspaceId_authorId_archivedAt_idx" ON "StickyNote"("workspaceId", "authorId", "archivedAt");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_occurredAt_idx" ON "Activity"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_kind_occurredAt_idx" ON "Activity"("workspaceId", "kind", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_leadId_occurredAt_idx" ON "Activity"("workspaceId", "leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_actorType_idx" ON "Activity"("workspaceId", "actorType");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_state_lastMessageAt_idx" ON "Conversation"("workspaceId", "state", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_isUnread_idx" ON "Conversation"("workspaceId", "isUnread");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_leadId_idx" ON "Conversation"("workspaceId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_idempotencyKey_key" ON "Message"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Message_workspaceId_conversationId_createdAt_idx" ON "Message"("workspaceId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_workspaceId_state_idx" ON "Message"("workspaceId", "state");

-- CreateIndex
CREATE INDEX "Message_workspaceId_sentAt_idx" ON "Message"("workspaceId", "sentAt");

-- CreateIndex
CREATE INDEX "Sequence_workspaceId_isActive_idx" ON "Sequence"("workspaceId", "isActive");

-- CreateIndex
CREATE INDEX "SequenceStep_workspaceId_idx" ON "SequenceStep"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_sequenceId_stepOrder_key" ON "SequenceStep"("sequenceId", "stepOrder");

-- CreateIndex
CREATE INDEX "SequenceEnrollment_workspaceId_state_idx" ON "SequenceEnrollment"("workspaceId", "state");

-- CreateIndex
CREATE INDEX "SequenceEnrollment_nextSendAt_idx" ON "SequenceEnrollment"("nextSendAt");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceEnrollment_sequenceId_leadId_key" ON "SequenceEnrollment"("sequenceId", "leadId");

-- CreateIndex
CREATE INDEX "Suppression_workspaceId_idx" ON "Suppression"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_workspaceId_kind_value_key" ON "Suppression"("workspaceId", "kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_publicToken_key" ON "Proposal"("publicToken");

-- CreateIndex
CREATE INDEX "Proposal_workspaceId_state_idx" ON "Proposal"("workspaceId", "state");

-- CreateIndex
CREATE INDEX "Proposal_workspaceId_dealId_idx" ON "Proposal"("workspaceId", "dealId");

-- CreateIndex
CREATE INDEX "ProposalItem_proposalId_idx" ON "ProposalItem"("proposalId");

-- CreateIndex
CREATE INDEX "ProposalItem_workspaceId_idx" ON "ProposalItem"("workspaceId");

-- CreateIndex
CREATE INDEX "ProposalView_proposalId_viewedAt_idx" ON "ProposalView"("proposalId", "viewedAt");

-- CreateIndex
CREATE INDEX "ProposalView_workspaceId_idx" ON "ProposalView"("workspaceId");

-- CreateIndex
CREATE INDEX "Booking_workspaceId_startsAt_idx" ON "Booking"("workspaceId", "startsAt");

-- CreateIndex
CREATE INDEX "Booking_workspaceId_leadId_idx" ON "Booking"("workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "CommitteeMember_workspaceId_companyId_idx" ON "CommitteeMember"("workspaceId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CommitteeMember_companyId_personId_key" ON "CommitteeMember"("companyId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_workspaceId_name_key" ON "Competitor"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "ResearchReport_workspaceId_leadId_idx" ON "ResearchReport"("workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "ResearchReport_workspaceId_startedAt_idx" ON "ResearchReport"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "AIInsight_workspaceId_kind_createdAt_idx" ON "AIInsight"("workspaceId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "AIInsight_workspaceId_forUserId_dismissedAt_idx" ON "AIInsight"("workspaceId", "forUserId", "dismissedAt");

-- CreateIndex
CREATE INDEX "NextBestAction_workspaceId_leadId_rank_idx" ON "NextBestAction"("workspaceId", "leadId", "rank");

-- CreateIndex
CREATE INDEX "NextBestAction_workspaceId_dealId_rank_idx" ON "NextBestAction"("workspaceId", "dealId", "rank");

-- CreateIndex
CREATE INDEX "ReadinessItem_workspaceId_idx" ON "ReadinessItem"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ReadinessItem_leadId_code_key" ON "ReadinessItem"("leadId", "code");

-- CreateIndex
CREATE INDEX "AIAgent_workspaceId_isEnabled_idx" ON "AIAgent"("workspaceId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "AIAgent_workspaceId_kind_key" ON "AIAgent"("workspaceId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotConfig_workspaceId_key" ON "AutopilotConfig"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_idempotencyKey_key" ON "AgentRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentRun_workspaceId_startedAt_idx" ON "AgentRun"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_startedAt_idx" ON "AgentRun"("agentId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentAction_workspaceId_occurredAt_idx" ON "AgentAction"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "AgentAction_workspaceId_state_requiresApproval_idx" ON "AgentAction"("workspaceId", "state", "requiresApproval");

-- CreateIndex
CREATE UNIQUE INDEX "AgentAction_runId_sequence_key" ON "AgentAction"("runId", "sequence");

-- CreateIndex
CREATE INDEX "Playbook_workspaceId_isActive_idx" ON "Playbook"("workspaceId", "isActive");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_workspaceId_kind_isActive_idx" ON "KnowledgeDoc"("workspaceId", "kind", "isActive");

-- CreateIndex
CREATE INDEX "AIRequestLog_workspaceId_createdAt_idx" ON "AIRequestLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AIRequestLog_workspaceId_feature_idx" ON "AIRequestLog"("workspaceId", "feature");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_userId_readAt_idx" ON "Notification"("workspaceId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_createdAt_idx" ON "Notification"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_objectType_objectId_idx" ON "AuditLog"("workspaceId", "objectType", "objectId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_source_idx" ON "AuditLog"("workspaceId", "source");

-- CreateIndex
CREATE INDEX "DeletedRecord_workspaceId_purgeAfter_idx" ON "DeletedRecord"("workspaceId", "purgeAfter");

-- CreateIndex
CREATE UNIQUE INDEX "DeletedRecord_workspaceId_objectType_objectId_key" ON "DeletedRecord"("workspaceId", "objectType", "objectId");

-- CreateIndex
CREATE INDEX "Webhook_workspaceId_isActive_idx" ON "Webhook"("workspaceId", "isActive");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_createdAt_idx" ON "WebhookDelivery"("webhookId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_nextRetryAt_idx" ON "WebhookDelivery"("nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_workspaceId_revokedAt_idx" ON "ApiKey"("workspaceId", "revokedAt");

-- CreateIndex
CREATE INDEX "File_workspaceId_deletedAt_idx" ON "File"("workspaceId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_workspaceId_key_key" ON "FeatureFlag"("workspaceId", "key");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointLedger" ADD CONSTRAINT "PointLedger_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpProfile" ADD CONSTRAINT "IcpProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringConfig" ADD CONSTRAINT "ScoringConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactMethod" ADD CONSTRAINT "ContactMethod_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipMemory" ADD CONSTRAINT "RelationshipMemory_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_icpProfileId_fkey" FOREIGN KEY ("icpProfileId") REFERENCES "IcpProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourcePhraseId_fkey" FOREIGN KEY ("sourcePhraseId") REFERENCES "SearchPhrase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScoreEvidence" ADD CONSTRAINT "LeadScoreEvidence_leadScoreId_fkey" FOREIGN KEY ("leadScoreId") REFERENCES "LeadScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_searchPhraseId_fkey" FOREIGN KEY ("searchPhraseId") REFERENCES "SearchPhrase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchPhrase" ADD CONSTRAINT "SearchPhrase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRun" ADD CONSTRAINT "SearchRun_searchPhraseId_fkey" FOREIGN KEY ("searchPhraseId") REFERENCES "SearchPhrase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "List" ADD CONSTRAINT "List_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListMember" ADD CONSTRAINT "ListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListMember" ADD CONSTRAINT "ListMember_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarWatch" ADD CONSTRAINT "RadarWatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealStageHistory" ADD CONSTRAINT "DealStageHistory_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealStageHistory" ADD CONSTRAINT "DealStageHistory_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealRisk" ADD CONSTRAINT "DealRisk_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyEntry" ADD CONSTRAINT "MoneyEntry_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickyNote" ADD CONSTRAINT "StickyNote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickyNote" ADD CONSTRAINT "StickyNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sequenceStepId_fkey" FOREIGN KEY ("sequenceStepId") REFERENCES "SequenceStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalItem" ADD CONSTRAINT "ProposalItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalView" ADD CONSTRAINT "ProposalView_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMember" ADD CONSTRAINT "CommitteeMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMember" ADD CONSTRAINT "CommitteeMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReport" ADD CONSTRAINT "ResearchReport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReport" ADD CONSTRAINT "ResearchReport_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReport" ADD CONSTRAINT "ResearchReport_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReport" ADD CONSTRAINT "ResearchReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInsight" ADD CONSTRAINT "AIInsight_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInsight" ADD CONSTRAINT "AIInsight_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextBestAction" ADD CONSTRAINT "NextBestAction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextBestAction" ADD CONSTRAINT "NextBestAction_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessItem" ADD CONSTRAINT "ReadinessItem_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAgent" ADD CONSTRAINT "AIAgent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotConfig" ADD CONSTRAINT "AutopilotConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playbook" ADD CONSTRAINT "Playbook_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDoc" ADD CONSTRAINT "KnowledgeDoc_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIRequestLog" ADD CONSTRAINT "AIRequestLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletedRecord" ADD CONSTRAINT "DeletedRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
