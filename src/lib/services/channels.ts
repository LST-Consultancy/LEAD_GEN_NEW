import "server-only";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";

/**
 * How many people you could actually reach on each channel, from real rows.
 *
 * The channel screens exist mostly to explain what isn't built, and a screen
 * like that is easy to fill with nothing. These counts are the part that is
 * genuinely useful today: they say whether the gap even matters for this
 * workspace. A WhatsApp adapter is worth nothing to a list with no mobile
 * numbers on it.
 *
 * Every count is visibility-scoped in SQL, so a rep sees reach across their own
 * leads rather than the workspace's.
 */

export type ChannelReach = {
  /** Leads whose contact has at least one address of this kind. */
  reachable: number;
  /** Of those, how many have at least one *revealed* value — a locked one can't be used. */
  revealed: number;
  /** Of those, how many are opted out or suppressed. */
  suppressed: number;
  /** Leads this caller can see at all, as the denominator. */
  totalLeads: number;
};

const KINDS = {
  whatsapp: ["MOBILE", "WHATSAPP"] as const,
  linkedin: ["LINKEDIN_URL"] as const,
  email: ["WORK_EMAIL", "PERSONAL_EMAIL"] as const,
};

export async function getChannelReach(
  ctx: AuthContext,
  channel: keyof typeof KINDS
): Promise<ChannelReach> {
  const visible = leadVisibilityFilter(ctx);
  const leadScope = { workspaceId: ctx.workspaceId, deletedAt: null, ...visible };
  const kinds = [...KINDS[channel]];

  // Every figure counts **leads**, not contact methods. Counting methods made
  // "with an address" exceed the lead count whenever someone had both a work
  // and a personal address — a numerator larger than its own denominator.
  const [totalLeads, reachable, revealed] = await Promise.all([
    db.lead.count({ where: leadScope }),
    db.lead.count({
      where: { ...leadScope, person: { contactMethods: { some: { kind: { in: kinds } } } } },
    }),
    db.lead.count({
      where: {
        ...leadScope,
        person: { contactMethods: { some: { kind: { in: kinds }, isLocked: false } } },
      },
    }),
  ]);

  // The suppression list works on values, not on contact rows, so it needs a
  // second pass. Counted as leads and merged with a set union rather than
  // added: a lead that is both opted out and on the list is one lead, and
  // adding the two produced a "suppressed" figure larger than the reach it
  // came out of.
  const listed = await suppressedByList(ctx, channel, kinds, leadScope);
  const optedOutIds = await db.lead.findMany({
    where: {
      ...leadScope,
      person: {
        contactMethods: {
          some: { kind: { in: kinds } },
          every: { OR: [{ kind: { notIn: kinds } }, { optedOutAt: { not: null } }] },
        },
      },
    },
    select: { id: true },
  });

  const union = new Set([...optedOutIds.map((l) => l.id), ...listed]);

  return { totalLeads, reachable, revealed, suppressed: union.size };
}

/**
 * Leads whose address of this kind is on the workspace suppression list.
 *
 * A locked address has a null `value` and so cannot be matched here. That is
 * not a hole in the guarantee: `checkSendable` re-checks suppression against
 * the revealed value at send time, and that is the gate that actually stops a
 * message. This count is a planning figure, and it says so on screen.
 */
async function suppressedByList(
  ctx: AuthContext,
  channel: keyof typeof KINDS,
  kinds: string[],
  leadScope: Record<string, unknown>
): Promise<string[]> {
  if (channel === "linkedin") return [];

  const entries = await db.suppression.findMany({
    where: { workspaceId: ctx.workspaceId, kind: { in: [channel, "domain"] } },
    select: { kind: true, value: true },
    // Bounded: a very large list would make this query unreasonable, and an
    // undercount that is labelled as one beats a slow page.
    take: 500,
  });
  if (entries.length === 0) return [];

  const exact = entries.filter((e) => e.kind !== "domain").map((e) => e.value.toLowerCase());
  const domains = entries.filter((e) => e.kind === "domain").map((e) => e.value.toLowerCase());

  const matches = await db.lead.findMany({
    where: {
      ...leadScope,
      person: {
        contactMethods: {
          some: {
            kind: { in: kinds as never },
            OR: [
              ...(exact.length ? [{ value: { in: exact, mode: "insensitive" as const } }] : []),
              ...domains.map((d) => ({
                value: { endsWith: `@${d}`, mode: "insensitive" as const },
              })),
            ],
          },
        },
      },
    },
    select: { id: true },
  });
  return matches.map((m) => m.id);
}

/**
 * Leads with a LinkedIn URL recorded, for the assisted workflow.
 *
 * Returns the URL only when it has been revealed. A locked value is a value
 * this caller has not paid to see, and handing it over here would be a way
 * around the reveal.
 */
export async function listLinkedInTargets(ctx: AuthContext, limit = 25) {
  const leads = await db.lead.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      archivedAt: null,
      ...leadVisibilityFilter(ctx),
      person: { contactMethods: { some: { kind: "LINKEDIN_URL" } } },
    },
    orderBy: [{ score: { composite: "desc" } }, { surfacedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      surfacedReason: true,
      lastContactedAt: true,
      company: { select: { name: true, industry: true } },
      score: { select: { displayScore: true } },
      person: {
        select: {
          fullName: true,
          headline: true,
          contactMethods: {
            where: { kind: "LINKEDIN_URL" },
            select: { value: true, maskedValue: true, isLocked: true },
            take: 1,
          },
        },
      },
    },
  });

  return leads.map((l) => {
    const method = l.person.contactMethods[0];
    return {
      leadId: l.id,
      name: l.person.fullName,
      headline: l.person.headline,
      companyName: l.company.name,
      industry: l.company.industry,
      score: l.score ? Number(l.score.displayScore) : 0,
      surfacedReason: l.surfacedReason,
      lastContactedAt: l.lastContactedAt?.toISOString() ?? null,
      /** Null while locked — the masked form is what the screen may show. */
      profileUrl: method?.isLocked ? null : (method?.value ?? null),
      maskedUrl: method?.maskedValue ?? "",
      isLocked: method?.isLocked ?? true,
    };
  });
}
