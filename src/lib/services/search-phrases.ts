import "server-only";
import { z } from "zod";
import { patchSchemaOf } from "@/lib/schema/patch";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate, softDelete } from "@/lib/services/mutate";

/**
 * Search phrases — the queries that feed the radar.
 *
 * §57/§58 — the point of tracking these individually is attribution: which
 * phrase produced leads that produced revenue. That chain is computed from real
 * rows here rather than estimated, so a phrase that looks productive but never
 * converts is visible as such.
 */

export const phraseSchema = z.object({
  phrase: z.string().trim().min(3).max(300),
  sourceKind: z.enum([
    "PUBLIC_WEB",
    "JOB_BOARD",
    "NEWS",
    "SOCIAL_PUBLIC",
    "COMPANY_SITE",
    "LICENSED_DATASET",
    "USER_INTEGRATION",
    "USER_MANUAL",
    "TENDER_PORTAL",
  ]),
  isActive: z.boolean().default(true),
  cadenceHours: z.number().int().min(1).max(720).default(24),
  negativeKeywords: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
});

export type PhraseInput = z.input<typeof phraseSchema>;

/**
 * Full funnel per phrase: signals → leads → contacted → replied → deals → won.
 *
 * Deliberately one aggregate query per stage rather than a single clever join,
 * because the numbers have to be individually checkable against the tables.
 */
export async function listSearchPhrases(ctx: AuthContext) {
  const phrases = await db.searchPhrase.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { signals: true, leads: true, runs: true } },
      runs: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: { state: true, startedAt: true, finishedAt: true, signalsFound: true, errorMessage: true },
      },
    },
  });

  const analytics = await Promise.all(
    phrases.map(async (p) => {
      const scope = { workspaceId: ctx.workspaceId, sourcePhraseId: p.id, deletedAt: null };

      const [tierCounts, contacted, replied, dealAgg, wonAgg, avgScore] = await Promise.all([
        db.lead.groupBy({ by: ["tier"], where: scope, _count: true }),
        db.lead.count({ where: { ...scope, lastContactedAt: { not: null } } }),
        db.lead.count({ where: { ...scope, repliedAt: { not: null } } }),
        db.deal.aggregate({
          where: { workspaceId: ctx.workspaceId, deletedAt: null, lead: { sourcePhraseId: p.id } },
          _sum: { valueInr: true },
          _count: true,
        }),
        db.deal.aggregate({
          where: {
            workspaceId: ctx.workspaceId,
            deletedAt: null,
            status: "WON",
            lead: { sourcePhraseId: p.id },
          },
          _sum: { valueInr: true },
          _count: true,
        }),
        db.leadScore.aggregate({
          where: { workspaceId: ctx.workspaceId, lead: { sourcePhraseId: p.id } },
          _avg: { displayScore: true },
        }),
      ]);

      const byTier = Object.fromEntries(tierCounts.map((t) => [t.tier, t._count]));
      const leads = tierCounts.reduce((s, t) => s + t._count, 0);
      const tierA = byTier.A ?? 0;

      return {
        id: p.id,
        leads,
        tierA,
        tierAPct: leads > 0 ? Math.round((tierA / leads) * 100) : null,
        avgScore: avgScore._avg.displayScore ? Number(avgScore._avg.displayScore) : null,
        contacted,
        replied,
        // Reply rate is only meaningful once something was actually sent.
        replyRate: contacted > 0 ? Math.round((replied / contacted) * 100) : null,
        dealCount: dealAgg._count,
        dealInr: Number(dealAgg._sum.valueInr ?? 0),
        wonCount: wonAgg._count,
        wonInr: Number(wonAgg._sum.valueInr ?? 0),
      };
    })
  );
  const byId = new Map(analytics.map((a) => [a.id, a]));

  return toPlain(
    phrases.map((p) => ({
      id: p.id,
      phrase: p.phrase,
      sourceKind: p.sourceKind,
      isActive: p.isActive,
      cadenceHours: p.cadenceHours,
      negativeKeywords: p.negativeKeywords,
      createdByAi: p.createdByAi,
      lastRunAt: p.lastRunAt,
      nextRunAt: p.nextRunAt,
      signalCount: p._count.signals,
      runCount: p._count.runs,
      lastRun: p.runs[0] ?? null,
      analytics: byId.get(p.id)!,
    }))
  );
}

/**
 * §57 — which phrases are worth keeping.
 *
 * Only comments where there is enough data to justify a comment; below the
 * threshold it says so instead of ranking noise.
 */
export async function getPhraseVerdicts(ctx: AuthContext) {
  const phrases = await listSearchPhrases(ctx);
  const MIN_LEADS = 5;

  const judged = phrases.map((p) => {
    const a = p.analytics;
    if (a.leads < MIN_LEADS) {
      return {
        id: p.id,
        phrase: p.phrase,
        verdict: "insufficient_data" as const,
        note: `Only ${a.leads} ${a.leads === 1 ? "lead" : "leads"} so far — too few to judge. Needs at least ${MIN_LEADS}.`,
      };
    }
    if (a.wonInr > 0) {
      return {
        id: p.id,
        phrase: p.phrase,
        verdict: "proven" as const,
        note: `Produced ${a.wonCount} won ${a.wonCount === 1 ? "deal" : "deals"}. This phrase has paid for itself.`,
      };
    }
    if ((a.tierAPct ?? 0) >= 20) {
      return {
        id: p.id,
        phrase: p.phrase,
        verdict: "promising" as const,
        note: `${a.tierAPct}% of its leads rate Tier A, well above average. Worth expanding with adjacent wording.`,
      };
    }
    if (a.contacted >= 10 && (a.replyRate ?? 0) < 5) {
      return {
        id: p.id,
        phrase: p.phrase,
        verdict: "underperforming" as const,
        note: `${a.contacted} contacted and only ${a.replied} replied. The leads may match on paper but not in practice.`,
      };
    }
    if ((a.tierAPct ?? 0) === 0 && a.leads >= 20) {
      return {
        id: p.id,
        phrase: p.phrase,
        verdict: "underperforming" as const,
        note: `${a.leads} leads and not one rated Tier A. This phrase is probably too broad.`,
      };
    }
    return {
      id: p.id,
      phrase: p.phrase,
      verdict: "acceptable" as const,
      note: `${a.leads} leads, ${a.tierAPct}% Tier A. Nothing wrong with it, nothing remarkable either.`,
    };
  });

  return {
    verdicts: judged,
    summary: {
      proven: judged.filter((v) => v.verdict === "proven").length,
      promising: judged.filter((v) => v.verdict === "promising").length,
      underperforming: judged.filter((v) => v.verdict === "underperforming").length,
      insufficient: judged.filter((v) => v.verdict === "insufficient_data").length,
    },
  };
}

export async function createSearchPhrase(ctx: AuthContext, raw: PhraseInput) {
  const input = phraseSchema.parse(raw);

  const duplicate = await db.searchPhrase.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      phrase: { equals: input.phrase, mode: "insensitive" },
      sourceKind: input.sourceKind,
    },
  });
  if (duplicate) {
    throw new MutationError(
      "You already watch that phrase on this source. Two copies would just double the cost.",
      "duplicate_phrase",
      409
    );
  }

  return mutate(ctx, PERMISSIONS.ICP_MANAGE, async () => {
    const phrase = await db.searchPhrase.create({
      data: {
        workspaceId: ctx.workspaceId,
        ...input,
        createdByAi: false,
        nextRunAt: input.isActive ? new Date(Date.now() + 60_000) : null,
      },
    });
    return {
      result: toPlain({ id: phrase.id, phrase: phrase.phrase, isActive: phrase.isActive }),
      log: {
        action: "search_phrase.created",
        objectType: "SearchPhrase",
        objectId: phrase.id,
        after: { phrase: phrase.phrase, sourceKind: phrase.sourceKind },
        activity: {
          kind: "search_phrase.created",
          summary: `Now watching: "${phrase.phrase}"`,
          detail: `Source: ${phrase.sourceKind.toLowerCase().replace(/_/g, " ")}, every ${phrase.cadenceHours}h`,
        },
      },
    };
  });
}

// Not `.partial()`: that keeps each field's `.default()`, so a PATCH of one
// field reset every other defaulted column — reactivating a paused watch and
// clearing its negative keywords. See `lib/schema/patch.ts`.
export const updatePhraseSchema = patchSchemaOf(phraseSchema);

export async function updateSearchPhrase(
  ctx: AuthContext,
  id: string,
  raw: z.input<typeof updatePhraseSchema>
) {
  const input = updatePhraseSchema.parse(raw);
  const existing = await loadScoped(
    () => db.searchPhrase.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }),
    "That search phrase"
  );

  return mutate(ctx, PERMISSIONS.ICP_MANAGE, async () => {
    const updated = await db.searchPhrase.update({
      where: { id },
      data: {
        ...input,
        // Pausing clears the next run; resuming schedules one shortly.
        ...(input.isActive === false ? { nextRunAt: null } : {}),
        ...(input.isActive === true && !existing.isActive
          ? { nextRunAt: new Date(Date.now() + 60_000) }
          : {}),
      },
    });

    return {
      result: toPlain({
        id: updated.id,
        phrase: updated.phrase,
        isActive: updated.isActive,
        cadenceHours: updated.cadenceHours,
        negativeKeywords: updated.negativeKeywords,
      }),
      log: {
        action:
          input.isActive === false
            ? "search_phrase.paused"
            : input.isActive === true && !existing.isActive
              ? "search_phrase.resumed"
              : "search_phrase.updated",
        objectType: "SearchPhrase",
        objectId: id,
        before: {
          phrase: existing.phrase,
          isActive: existing.isActive,
          cadenceHours: existing.cadenceHours,
        },
        after: {
          phrase: updated.phrase,
          isActive: updated.isActive,
          cadenceHours: updated.cadenceHours,
        },
      },
    };
  });
}

export async function deleteSearchPhrase(ctx: AuthContext, id: string) {
  const phrase = await loadScoped(
    () =>
      db.searchPhrase.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
        include: { _count: { select: { leads: true } } },
      }),
    "That search phrase"
  );

  return mutate(ctx, PERMISSIONS.ICP_MANAGE, async () => {
    await db.searchPhrase.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await softDelete(ctx, {
      objectType: "SearchPhrase",
      objectId: id,
      label: phrase.phrase,
    });
    return {
      result: {
        id,
        deleted: true,
        // Attribution has to survive the phrase being removed, or historical
        // revenue loses its origin.
        note:
          phrase._count.leads > 0
            ? `${phrase._count.leads} existing leads keep their attribution to this phrase.`
            : undefined,
      },
      log: {
        action: "search_phrase.deleted",
        objectType: "SearchPhrase",
        objectId: id,
        before: { phrase: phrase.phrase },
        activity: {
          kind: "search_phrase.deleted",
          summary: `Stopped watching: "${phrase.phrase}"`,
        },
      },
    };
  });
}

/** Run history for one phrase. */
export async function getPhraseRuns(ctx: AuthContext, id: string) {
  await loadScoped(
    () => db.searchPhrase.findFirst({ where: { id, workspaceId: ctx.workspaceId } }),
    "That search phrase"
  );

  const runs = await db.searchRun.findMany({
    where: { workspaceId: ctx.workspaceId, searchPhraseId: id },
    orderBy: { startedAt: "desc" },
    take: 30,
  });

  return toPlain(
    runs.map((r) => ({
      id: r.id,
      state: r.state,
      signalsFound: r.signalsFound,
      leadsCreated: r.leadsCreated,
      duplicates: r.duplicates,
      errorMessage: r.errorMessage,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs:
        r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
    }))
  );
}
