import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { leadVisibilityFilter } from "@/lib/auth/context";
import { handleApiError } from "@/lib/api/respond";
import { resolveCaller } from "@/lib/api/caller";

/** §117 — universal search, grouped by entity, scoped to the active workspace. */
export async function GET(req: NextRequest) {
  try {
    // Accepts a browser session or an API key holding "leads.read".
    const caller = await resolveCaller(req.headers, { scope: "leads.read" });
    if (!caller.ok) return caller.response;
    const ctx = caller.ctx;

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) {
      return NextResponse.json({ leads: [], companies: [], deals: [], proposals: [] });
    }

    const like = { contains: q, mode: "insensitive" as const };
    const ownerScope = leadVisibilityFilter(ctx);

    const [leads, companies, deals, proposals] = await Promise.all([
      db.lead.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ...ownerScope,
          OR: [{ person: { fullName: like } }, { company: { name: like } }],
        },
        take: 6,
        orderBy: { score: { composite: "desc" } },
        select: {
          id: true,
          tier: true,
          person: {
            select: {
              fullName: true,
              employments: { where: { isCurrent: true }, take: 1, select: { title: true } },
            },
          },
          company: { select: { name: true } },
          score: { select: { displayScore: true } },
        },
      }),
      db.company.findMany({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, OR: [{ name: like }, { domain: like }] },
        take: 5,
        orderBy: { intentScore: "desc" },
        select: {
          id: true,
          name: true,
          industry: true,
          city: true,
          _count: { select: { leads: true } },
        },
      }),
      db.deal.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ...(ownerScope.ownerId ? { ownerId: ownerScope.ownerId } : {}),
          OR: [{ title: like }, { company: { name: like } }],
        },
        take: 5,
        orderBy: { valueInr: "desc" },
        select: {
          id: true,
          title: true,
          valueInr: true,
          company: { select: { name: true } },
          stage: { select: { name: true } },
        },
      }),
      db.proposal.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          OR: [{ title: like }, { company: { name: like } }],
        },
        take: 4,
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, state: true, company: { select: { name: true } } },
      }),
    ]);

    return NextResponse.json({
      leads: leads.map((l) => ({
        id: l.id,
        name: l.person.fullName,
        title: l.person.employments[0]?.title ?? "—",
        company: l.company.name,
        tier: l.tier,
        score: Number(l.score?.displayScore ?? 0),
      })),
      companies: companies.map((c) => ({
        id: c.id,
        name: c.name,
        industry: c.industry,
        city: c.city,
        leadCount: c._count.leads,
      })),
      deals: deals.map((d) => ({
        id: d.id,
        title: d.title,
        company: d.company.name,
        valueInr: Number(d.valueInr),
        stage: d.stage.name,
      })),
      proposals: proposals.map((p) => ({
        id: p.id,
        title: p.title,
        company: p.company.name,
        state: p.state,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
