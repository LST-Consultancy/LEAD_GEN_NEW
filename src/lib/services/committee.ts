import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { mutate, MutationError } from "./mutate";
import { getAccount } from "./people";
import { COMMITTEE_ROLES, coverage, suggestRole } from "@/lib/accounts/committee";
import { COMMITTEE_ROLE_LABEL } from "@/lib/vocab";

/** Same visibility as the account screen: out of tenant or out of sight is a 404. */
async function visibleAccount(ctx: AuthContext, companyId: string) {
  if (!z.string().uuid().safeParse(companyId).success) throw new MutationError("That account was not found.", "not_found", 404);
  const account = await getAccount(ctx, companyId);
  if (!account) throw new MutationError("That account was not found.", "not_found", 404);
  return account;
}

/** The mapped committee, its coverage, and a suggested role for each current person not yet on it. */
export async function getCommittee(ctx: AuthContext, companyId: string) {
  await visibleAccount(ctx, companyId);
  const [members, jobs] = await Promise.all([
    db.committeeMember.findMany({ where: { workspaceId: ctx.workspaceId, companyId, removedAt: null }, include: { person: { select: { id: true, fullName: true, linkedinUrl: true } } }, orderBy: { influence: "desc" } }),
    db.employment.findMany({ where: { workspaceId: ctx.workspaceId, companyId, isCurrent: true, person: { deletedAt: null } }, select: { personId: true, title: true, isDecisionMaker: true, association: true, person: { select: { fullName: true, linkedinUrl: true } } } }),
  ]);
  const onCommittee = new Set(members.map(m => m.personId));
  const titleOf = new Map(jobs.map(j => [j.personId, j.title]));
  return toPlain({
    members: members.map(m => ({ id: m.id, personId: m.personId, name: m.person.fullName, linkedinUrl: m.person.linkedinUrl, title: titleOf.get(m.personId) ?? null, role: m.role, influence: m.influence, sentiment: m.sentiment, note: m.note, confirmed: m.confirmedAt !== null, suggested: m.isAiSuggested })),
    suggestions: jobs.filter(j => !onCommittee.has(j.personId)).map(j => ({ personId: j.personId, name: j.person.fullName, title: j.title, association: j.association, ...suggestRole(j.title, j.isDecisionMaker) })),
    coverage: coverage(members.map(m => ({ role: m.role, confirmed: m.confirmedAt !== null }))),
  });
}

const memberSchema = z.object({ personId: z.string().uuid(), role: z.enum(COMMITTEE_ROLES), influence: z.number().int().min(0).max(100).default(50), sentiment: z.enum(["positive", "neutral", "negative"]).nullable().default(null), note: z.string().trim().max(500).nullable().default(null) });
/** A person places someone on the committee; that is a confirmation, never a suggestion. */
export async function setCommitteeMember(ctx: AuthContext, companyId: string, raw: unknown) {
  const input = memberSchema.parse(raw ?? {});
  const account = await visibleAccount(ctx, companyId);
  const job = await db.employment.findFirst({ where: { workspaceId: ctx.workspaceId, companyId, personId: input.personId, isCurrent: true } });
  if (!job) throw new MutationError("That person is not recorded as working at this account now.", "person_not_at_company", 422);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const before = await db.committeeMember.findUnique({ where: { companyId_personId: { companyId, personId: input.personId } } });
    const row = await db.committeeMember.upsert({ where: { companyId_personId: { companyId, personId: input.personId } },
      create: { workspaceId: ctx.workspaceId, companyId, personId: input.personId, role: input.role, influence: input.influence, sentiment: input.sentiment, note: input.note, isAiSuggested: false, confirmedAt: new Date() },
      update: { role: input.role, influence: input.influence, sentiment: input.sentiment, note: input.note, isAiSuggested: false, confirmedAt: new Date(), removedAt: null } });
    return { result: toPlain(row), log: { action: "committee.member_set", objectType: "Company", objectId: companyId, before: before ? { personId: before.personId, role: before.role } : null, after: { personId: row.personId, role: row.role }, activity: { kind: "committee.member_set", summary: `${COMMITTEE_ROLE_LABEL[row.role]} mapped at ${account.name}` } } };
  });
}

/** Takes someone off the committee (kept as removed, not deleted); their person and employment records are untouched. */
export async function removeCommitteeMember(ctx: AuthContext, companyId: string, personId: string) {
  await visibleAccount(ctx, companyId);
  z.string().uuid().parse(personId);
  const row = await db.committeeMember.findFirst({ where: { workspaceId: ctx.workspaceId, companyId, personId, removedAt: null } });
  if (!row) throw new MutationError("That person is not on this committee.", "not_found", 404);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    await db.committeeMember.update({ where: { id: row.id }, data: { removedAt: new Date() } });
    return { result: { removed: true }, log: { action: "committee.member_removed", objectType: "Company", objectId: companyId, before: { personId, role: row.role } } };
  });
}
