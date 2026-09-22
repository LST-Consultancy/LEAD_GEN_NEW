import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import { SYSTEM_ROLES } from "@/lib/auth/permissions";
import type { AuthContext } from "@/lib/auth/context";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const db = new PrismaClient({ adapter });

type RoleKey = keyof typeof SYSTEM_ROLES;

function contextFor(
  user: { id: string; name: string; email: string },
  workspace: { id: string; name: string; slug: string },
  role: { key: string; name: string; permissions: string[] },
  memberId: string
): AuthContext {
  return {
    userId: user.id,
    sessionId: randomUUID(),
    user: { id: user.id, name: user.name, email: user.email, avatarUrl: null, timezone: "Asia/Kolkata" },
    workspaceId: workspace.id,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      currency: "INR",
      timezone: "Asia/Kolkata",
      logoUrl: null,
      autopilotMode: "OFF",
      onboardedAt: new Date(),
    },
    memberId,
    roleKey: role.key,
    roleName: role.name,
    permissions: role.permissions,
    workspaces: [
      { id: workspace.id, name: workspace.name, slug: workspace.slug, roleName: role.name },
    ],
  };
}

/**
 * Builds an isolated workspace with its own user, role and subscription. Two of
 * these are what the tenant-isolation tests use to prove one cannot see the
 * other's rows.
 */
export async function makeWorkspace(label: string, roleKey: RoleKey = "owner") {
  const suffix = randomUUID().slice(0, 8);

  const user = await db.user.create({
    data: { name: `${label} User`, email: `${label}-${suffix}@test.invalid` },
  });
  const workspace = await db.workspace.create({
    data: { name: `${label} ${suffix}`, slug: `${label.toLowerCase()}-${suffix}` },
  });
  const role = await db.role.create({
    data: {
      workspaceId: workspace.id,
      key: roleKey,
      name: SYSTEM_ROLES[roleKey].name,
      isSystem: true,
      permissions: SYSTEM_ROLES[roleKey].permissions,
    },
  });
  const member = await db.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, roleId: role.id, isDefault: true },
  });
  const plan = await db.plan.create({
    data: { key: `test-plan-${suffix}`, name: "Test plan", priceMonthly: 0, pointsMonthly: 1000 },
  });
  await db.subscription.create({
    data: {
      workspaceId: workspace.id,
      planId: plan.id,
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  return {
    ctx: contextFor(user, workspace, role, member.id),
    user,
    workspace,
    role,
    plan,
  };
}

/** Adds a second member to an existing workspace, with a different role. */
export async function addMember(
  workspaceId: string,
  label: string,
  roleKey: RoleKey
): Promise<AuthContext> {
  const suffix = randomUUID().slice(0, 8);
  const user = await db.user.create({
    data: { name: `${label} User`, email: `${label}-${suffix}@test.invalid` },
  });
  const role = await db.role.create({
    data: {
      workspaceId,
      key: `${roleKey}-${suffix}`,
      name: SYSTEM_ROLES[roleKey].name,
      permissions: SYSTEM_ROLES[roleKey].permissions,
    },
  });
  const member = await db.workspaceMember.create({
    data: { workspaceId, userId: user.id, roleId: role.id },
  });
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });

  return contextFor(user, workspace, role, member.id);
}

/** Creates a scored lead inside a workspace, optionally owned by someone. */
export async function makeLead(
  workspaceId: string,
  opts: {
    name?: string;
    companyName?: string;
    ownerId?: string | null;
    score?: number;
    tier?: "A" | "B" | "C" | "D";
    intent?: "COLD" | "AWARE" | "WARM" | "HOT" | "BUYING";
    industry?: string;
  } = {}
) {
  const suffix = randomUUID().slice(0, 8);
  const company = await db.company.create({
    data: {
      workspaceId,
      name: opts.companyName ?? `Company ${suffix}`,
      domain: `c-${suffix}.invalid`,
      industry: opts.industry ?? "Manufacturing",
      city: "Pune",
      state: "Maharashtra",
      employeeCount: 400,
    },
  });
  const person = await db.person.create({
    data: { workspaceId, fullName: opts.name ?? `Person ${suffix}` },
  });
  await db.employment.create({
    data: {
      workspaceId,
      personId: person.id,
      companyId: company.id,
      title: "Head of IT",
      seniority: "head",
      isDecisionMaker: true,
    },
  });
  const lead = await db.lead.create({
    data: {
      workspaceId,
      personId: person.id,
      companyId: company.id,
      ownerId: opts.ownerId ?? null,
      tier: opts.tier ?? "B",
      intent: opts.intent ?? "WARM",
      surfacedReason: "Test fixture",
    },
  });
  const score = opts.score ?? 7;
  await db.leadScore.create({
    data: {
      workspaceId,
      leadId: lead.id,
      composite: Math.round(score * 10),
      displayScore: score,
      fitScore: 70,
      intentScore: 60,
    },
  });
  return { lead, person, company };
}

/** Seeds an opening point balance so spend tests have something to draw on. */
export async function grantPoints(workspaceId: string, amount: number) {
  return db.pointLedger.create({
    data: {
      workspaceId,
      type: "PLAN_ALLOCATION",
      delta: amount,
      balanceAfter: amount,
      reason: "Test allocation",
      actorType: "SYSTEM",
      idempotencyKey: randomUUID(),
    },
  });
}

/** Removes workspaces, their users and plans so tests leave no residue. */
export async function cleanup(opts: {
  workspaceIds?: string[];
  userIds?: string[];
  planIds?: string[];
}) {
  if (opts.workspaceIds?.length) {
    await db.workspace.deleteMany({ where: { id: { in: opts.workspaceIds } } });
  }
  if (opts.userIds?.length) {
    await db.user.deleteMany({ where: { id: { in: opts.userIds } } });
  }
  if (opts.planIds?.length) {
    await db.plan.deleteMany({ where: { id: { in: opts.planIds } } });
  }
}
