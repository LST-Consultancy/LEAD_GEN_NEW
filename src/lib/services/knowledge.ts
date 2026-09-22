import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { toPlain } from "@/lib/serialize";
import { KNOWLEDGE_KINDS, type KnowledgeKind } from "@/lib/knowledge/kinds";

/**
 * §64 — the knowledge base.
 *
 * This is what the workspace actually sells. Its only real job is to stop a
 * generated draft claiming a capability, a price or a result that does not
 * exist — so an empty knowledge base is a fact worth stating loudly, not an
 * empty grid to decorate.
 */

export type KnowledgeSummary = {
  id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  isActive: boolean;
  updatedAt: string;
  createdByName: string | null;
  /** Characters, because that is what a token budget is spent on. */
  length: number;
};

export type KnowledgeCoverage = {
  kind: KnowledgeKind;
  total: number;
  active: number;
};

export async function listKnowledge(
  ctx: AuthContext,
  opts: { kind?: string; query?: string; includeInactive?: boolean } = {}
): Promise<{ docs: KnowledgeSummary[]; coverage: KnowledgeCoverage[]; activeTotal: number }> {
  const where = {
    workspaceId: ctx.workspaceId,
    deletedAt: null,
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.includeInactive ? {} : { isActive: true }),
    ...(opts.query
      ? {
          OR: [
            { title: { contains: opts.query, mode: "insensitive" as const } },
            { body: { contains: opts.query, mode: "insensitive" as const } },
            { tags: { has: opts.query.toLowerCase() } },
          ],
        }
      : {}),
  };

  const [docs, byKind] = await Promise.all([
    db.knowledgeDoc.findMany({
      where,
      orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
      take: 200,
    }),
    // Coverage counts ignore the current filter: the point of the strip is to
    // show what the base is missing overall, which a filtered count hides.
    db.knowledgeDoc.groupBy({
      by: ["kind", "isActive"],
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const authorIds = [...new Set(docs.map((d) => d.createdById).filter((id): id is string => !!id))];
  // Scoped through membership, not by id alone — an author id from another
  // tenant must resolve to nothing rather than leak a name.
  const authors = authorIds.length
    ? await db.user.findMany({
        where: {
          id: { in: authorIds },
          memberships: { some: { workspaceId: ctx.workspaceId } },
        },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(authors.map((a) => [a.id, a.name]));

  const coverage: KnowledgeCoverage[] = KNOWLEDGE_KINDS.map((kind) => {
    const rows = byKind.filter((r) => r.kind === kind);
    return {
      kind,
      total: rows.reduce((n, r) => n + r._count._all, 0),
      active: rows.filter((r) => r.isActive).reduce((n, r) => n + r._count._all, 0),
    };
  });

  return {
    docs: docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      body: d.body,
      tags: d.tags,
      isActive: d.isActive,
      updatedAt: d.updatedAt.toISOString(),
      createdByName: d.createdById ? (nameById.get(d.createdById) ?? null) : null,
      length: d.body.length,
    })),
    coverage,
    activeTotal: coverage.reduce((n, c) => n + c.active, 0),
  };
}

export async function getKnowledgeDoc(ctx: AuthContext, id: string) {
  const doc = await db.knowledgeDoc.findFirst({
    where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
  });
  // Out of tenant and non-existent must be indistinguishable from outside.
  return doc ? toPlain(doc) : null;
}
