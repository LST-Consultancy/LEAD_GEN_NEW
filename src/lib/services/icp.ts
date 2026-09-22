import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate, softDelete } from "@/lib/services/mutate";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";

/**
 * ICP profiles — the definition of who you sell to.
 *
 * Every lead score is computed against one of these, so editing an ICP
 * invalidates every score derived from it. That is why a save enqueues a
 * rescore rather than leaving the numbers quietly wrong.
 */

const stringList = z.array(z.string().trim().min(1).max(120)).max(100);

export const icpSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sellsDescription: z.string().trim().max(2000).nullable().optional(),
  industries: stringList.default([]),
  locations: stringList.default([]),
  employeeMin: z.number().int().min(0).max(10_000_000).nullable().optional(),
  employeeMax: z.number().int().min(0).max(10_000_000).nullable().optional(),
  revenueMinInr: z.number().min(0).nullable().optional(),
  revenueMaxInr: z.number().min(0).nullable().optional(),
  buyerRoles: stringList.default([]),
  seniorities: stringList.default([]),
  technologies: stringList.default([]),
  pains: stringList.default([]),
  triggerEvents: stringList.default([]),
  exclusions: stringList.default([]),
  isPrimary: z.boolean().optional(),
});

/**
 * What a caller passes. `z.input`, not `z.infer` — the schema fills in the list
 * defaults, so requiring them from the caller would be a lie about the API.
 */
export type IcpInput = z.input<typeof icpSchema>;

/** What the schema returns once parsed: defaults applied, lists present. */
type IcpParsed = z.output<typeof icpSchema>;

function validateRanges(input: IcpParsed) {
  if (
    input.employeeMin != null &&
    input.employeeMax != null &&
    input.employeeMin > input.employeeMax
  ) {
    throw new MutationError(
      "The minimum headcount is larger than the maximum, so nothing could ever match.",
      "invalid_range",
      400
    );
  }
  if (
    input.revenueMinInr != null &&
    input.revenueMaxInr != null &&
    input.revenueMinInr > input.revenueMaxInr
  ) {
    throw new MutationError(
      "The minimum revenue is larger than the maximum, so nothing could ever match.",
      "invalid_range",
      400
    );
  }
  // An exclusion that also appears as a target would silently cancel itself out.
  const overlap = input.exclusions.filter((e) =>
    input.industries.some((i) => i.toLowerCase() === e.toLowerCase())
  );
  if (overlap.length > 0) {
    throw new MutationError(
      `"${overlap[0]}" is listed as both a target industry and an exclusion. The exclusion would always win.`,
      "contradictory_rules",
      400
    );
  }
}

export async function listIcpProfiles(ctx: AuthContext) {
  const profiles = await db.icpProfile.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    include: { _count: { select: { leads: true } } },
  });

  // How each profile is actually performing, so the editor is not blind.
  const stats = await Promise.all(
    profiles.map(async (p) => {
      const [tierCounts, won] = await Promise.all([
        db.lead.groupBy({
          by: ["tier"],
          where: { workspaceId: ctx.workspaceId, icpProfileId: p.id, deletedAt: null },
          _count: true,
        }),
        db.deal.aggregate({
          where: {
            workspaceId: ctx.workspaceId,
            deletedAt: null,
            status: "WON",
            lead: { icpProfileId: p.id },
          },
          _sum: { valueInr: true },
          _count: true,
        }),
      ]);
      const byTier = Object.fromEntries(tierCounts.map((t) => [t.tier, t._count]));
      const total = tierCounts.reduce((s, t) => s + t._count, 0);
      return {
        id: p.id,
        leadCount: total,
        tierA: byTier.A ?? 0,
        tierB: byTier.B ?? 0,
        // The share of leads this definition rates highly — the clearest signal
        // of whether the ICP is too broad.
        precision: total > 0 ? Math.round((((byTier.A ?? 0) + (byTier.B ?? 0)) / total) * 100) : null,
        wonCount: won._count,
        wonInr: Number(won._sum.valueInr ?? 0),
      };
    })
  );
  const statsById = new Map(stats.map((s) => [s.id, s]));

  return toPlain(
    profiles.map((p) => ({
      id: p.id,
      name: p.name,
      isPrimary: p.isPrimary,
      sellsDescription: p.sellsDescription,
      industries: p.industries,
      locations: p.locations,
      employeeMin: p.employeeMin,
      employeeMax: p.employeeMax,
      revenueMinInr: p.revenueMinInr,
      revenueMaxInr: p.revenueMaxInr,
      buyerRoles: p.buyerRoles,
      seniorities: p.seniorities,
      technologies: p.technologies,
      pains: p.pains,
      triggerEvents: p.triggerEvents,
      exclusions: p.exclusions,
      updatedAt: p.updatedAt,
      stats: statsById.get(p.id)!,
    }))
  );
}

export async function createIcpProfile(ctx: AuthContext, raw: IcpInput) {
  const input = icpSchema.parse(raw);
  validateRanges(input);

  return mutate(ctx, PERMISSIONS.ICP_MANAGE, async () => {
    const existing = await db.icpProfile.count({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
    });
    // The first profile is primary by definition; there is nothing to compete with.
    const isPrimary = input.isPrimary ?? existing === 0;

    const profile = await db.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.icpProfile.updateMany({
          where: { workspaceId: ctx.workspaceId },
          data: { isPrimary: false },
        });
      }
      return tx.icpProfile.create({
        data: { workspaceId: ctx.workspaceId, ...input, isPrimary },
      });
    });

    return {
      result: toPlain({ id: profile.id, name: profile.name, isPrimary: profile.isPrimary }),
      log: {
        action: "icp.created",
        objectType: "IcpProfile",
        objectId: profile.id,
        after: { name: profile.name, industries: profile.industries },
        activity: {
          kind: "icp.created",
          summary: `ICP profile created: ${profile.name}`,
          detail: `${input.industries.length} industries, ${input.buyerRoles.length} buyer roles`,
        },
      },
    };
  });
}

export async function updateIcpProfile(ctx: AuthContext, id: string, raw: IcpInput) {
  const input = icpSchema.parse(raw);
  validateRanges(input);

  const existing = await loadScoped(
    () =>
      db.icpProfile.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
        include: { _count: { select: { leads: true } } },
      }),
    "That ICP profile"
  );

  return mutate(ctx, PERMISSIONS.ICP_MANAGE, async () => {
    const updated = await db.$transaction(async (tx) => {
      if (input.isPrimary && !existing.isPrimary) {
        await tx.icpProfile.updateMany({
          where: { workspaceId: ctx.workspaceId },
          data: { isPrimary: false },
        });
      }
      return tx.icpProfile.update({ where: { id }, data: input });
    });

    // Changing the definition changes every score derived from it, so the
    // numbers are stale the moment this saves. Queued rather than awaited.
    const rescore = await enqueue(
      JOB.RESCORE_WORKSPACE,
      { workspaceId: ctx.workspaceId, reason: `ICP "${updated.name}" changed` },
      { dedupeKey: `rescore-ws-${ctx.workspaceId}`, dedupeWindowSec: 30 }
    );

    return {
      result: toPlain({
        id: updated.id,
        name: updated.name,
        isPrimary: updated.isPrimary,
        affectedLeads: existing._count.leads,
        // Stated plainly, because the user needs to know the scores they are
        // looking at are about to change.
        rescoreQueued: rescore.queued,
        rescoreNote: rescore.queued
          ? `${existing._count.leads} leads scored against this profile will be recomputed in the background.`
          : `${existing._count.leads} leads are scored against this profile, but no queue is configured — their scores will stay stale until a worker runs.`,
      }),
      log: {
        action: "icp.updated",
        objectType: "IcpProfile",
        objectId: id,
        before: {
          industries: existing.industries,
          employeeMin: existing.employeeMin,
          employeeMax: existing.employeeMax,
          buyerRoles: existing.buyerRoles,
          exclusions: existing.exclusions,
        },
        after: {
          industries: updated.industries,
          employeeMin: updated.employeeMin,
          employeeMax: updated.employeeMax,
          buyerRoles: updated.buyerRoles,
          exclusions: updated.exclusions,
        },
        activity: {
          kind: "icp.updated",
          summary: `ICP profile updated: ${updated.name}`,
          detail: `${existing._count.leads} leads will be rescored.`,
        },
      },
    };
  });
}

export async function deleteIcpProfile(ctx: AuthContext, id: string) {
  const profile = await loadScoped(
    () =>
      db.icpProfile.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
        include: { _count: { select: { leads: true } } },
      }),
    "That ICP profile"
  );

  const remaining = await db.icpProfile.count({
    where: { workspaceId: ctx.workspaceId, deletedAt: null, id: { not: id } },
  });
  if (remaining === 0) {
    throw new MutationError(
      "This is your only ICP profile. Scoring needs at least one definition of who you sell to.",
      "last_profile",
      409
    );
  }
  if (profile._count.leads > 0) {
    throw new MutationError(
      `${profile._count.leads} leads are scored against this profile. Reassign them to another profile first, or their scores would lose their basis.`,
      "profile_in_use",
      409
    );
  }

  return mutate(ctx, PERMISSIONS.ICP_MANAGE, async () => {
    await db.icpProfile.update({ where: { id }, data: { deletedAt: new Date() } });
    await softDelete(ctx, { objectType: "IcpProfile", objectId: id, label: profile.name });

    // Losing the primary would leave scoring with no default.
    if (profile.isPrimary) {
      const next = await db.icpProfile.findFirst({
        where: { workspaceId: ctx.workspaceId, deletedAt: null },
        orderBy: { createdAt: "asc" },
      });
      if (next) {
        await db.icpProfile.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    }

    return {
      result: { id, deleted: true },
      log: {
        action: "icp.deleted",
        objectType: "IcpProfile",
        objectId: id,
        before: { name: profile.name },
        activity: { kind: "icp.deleted", summary: `ICP profile removed: ${profile.name}` },
      },
    };
  });
}

/**
 * How many leads currently in the database would match a candidate definition.
 *
 * Attribute-only: it answers "does this shape exist in what I already have",
 * which is the question worth asking before saving a definition. It cannot
 * answer "how many exist in the world" and does not pretend to.
 */
export async function previewIcpMatch(ctx: AuthContext, raw: IcpInput) {
  const input = icpSchema.parse(raw);

  // Only industry and size gate a match, mirroring the scoring engine: it
  // treats technology overlap as a bonus, not a requirement. Filtering on it
  // here made a perfectly good definition look like it matched nothing —
  // an implementation partner's prospects usually do *not* run the thing yet.
  const where = {
    workspaceId: ctx.workspaceId,
    deletedAt: null,
    company: {
      ...(input.industries.length ? { industry: { in: input.industries } } : {}),
      ...(input.employeeMin != null || input.employeeMax != null
        ? {
            employeeCount: {
              ...(input.employeeMin != null ? { gte: input.employeeMin } : {}),
              ...(input.employeeMax != null ? { lte: input.employeeMax } : {}),
            },
          }
        : {}),
    },
  };

  const [matching, total, sample, techOverlap] = await Promise.all([
    db.lead.count({ where }),
    db.lead.count({ where: { workspaceId: ctx.workspaceId, deletedAt: null } }),
    db.lead.findMany({
      where,
      take: 5,
      orderBy: { score: { composite: "desc" } },
      select: {
        id: true,
        person: { select: { fullName: true } },
        company: { select: { name: true, industry: true, employeeCount: true, technologies: true } },
        score: { select: { displayScore: true } },
      },
    }),
    // Reported separately, as a signal of how much the tech criteria will lift
    // scores — not as a gate on matching.
    input.technologies.length
      ? db.lead.count({
          where: { ...where, company: { ...where.company, technologies: { hasSome: input.technologies } } },
        })
      : Promise.resolve(0),
  ]);

  return toPlain({
    matching,
    total,
    techOverlap,
    sample: sample.map((l) => ({
      id: l.id,
      name: l.person.fullName,
      company: l.company.name,
      industry: l.company.industry,
      employeeCount: l.company.employeeCount,
      score: l.score ? Number(l.score.displayScore) : null,
      sharesTechnology: input.technologies.some((t) =>
        l.company.technologies.some((c) => c.toLowerCase() === t.toLowerCase())
      ),
    })),
    note:
      input.technologies.length > 0
        ? `Matched on industry and size. ${techOverlap} of these also run a technology you listed, which raises their fit score — technology is a bonus in scoring, not a filter.`
        : "Matched on industry and size. Role, seniority and trigger criteria affect the score rather than whether a lead matches.",
  });
}
