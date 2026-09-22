import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { leadVisibilityFilter } from "@/lib/auth/context";
import { formatInrCompact, formatAge } from "@/lib/format";
import { getRevenueInReach, getSalesHealth, getWorklist } from "@/lib/services/today";
import { z } from "zod";
import { createNote, createNoteSchema } from "@/lib/services/notes";
import { createTask, createTaskSchema } from "@/lib/services/tasks";
import { updateDeal, updateDealSchema } from "@/lib/services/deal-mutations";
import { revealContacts, quoteReveal } from "@/lib/services/lead-mutations";
import { formatInr } from "@/lib/format";

/**
 * §62 / §63 — the Copilot's tool registry. Each tool is a real scoped query
 * with a declared risk class. Answers are assembled from returned rows, so
 * every sentence the Copilot says has a row behind it.
 *
 * Only READ tools are wired up so far. WRITE, SPEND and EXTERNAL tools are
 * declared here with `implemented: false` so the surface is honest about what
 * it can and cannot do.
 */

export type RiskClass = "READ" | "WRITE" | "SPEND" | "EXTERNAL";

export type Evidence = { label: string; detail?: string; href?: string };

export type ToolResult = {
  text: string;
  evidence?: Evidence[];
};

export type Tool = {
  name: string;
  riskClass: RiskClass;
  description: string;
  /** Phrases that route a plain-language question to this tool. */
  match: RegExp[];
  implemented: boolean;
  /** READ tools answer a question and take no input. */
  run?: (ctx: AuthContext) => Promise<ToolResult>;
  /**
   * Anything that is not a READ takes structured input and changes something.
   *
   * `input` is the schema, so a caller — an agent, the MCP layer, a person —
   * is validated identically. `execute` delegates to the ordinary mutation
   * service, which means the permission check, the tenant scoping, the audit
   * row and the activity row all happen exactly as they do for a human. A tool
   * is never a second way into the database.
   */
  input?: z.ZodType;
  execute?: (ctx: AuthContext, input: unknown) => Promise<ToolResult>;
  /**
   * What this call will cost, from its input, before it runs. Needed because
   * the guardrails have to know the price to decide whether approval is
   * required — after the fact is too late.
   */
  priceOf?: (ctx: AuthContext, input: unknown) => Promise<number>;
  /** The lead this input acts on, so targeting rules can be applied. */
  leadIdOf?: (input: unknown) => string | undefined;
};

export const TOOLS: Tool[] = [
  {
    name: "get_today",
    riskClass: "READ",
    description: "What deserves attention today, ranked by revenue impact.",
    match: [/what should i do/i, /today/i, /priorit/i, /where do i start/i, /my day/i],
    implemented: true,
    run: async (ctx) => {
      const tasks = await getWorklist(ctx, 5);
      if (tasks.length === 0) {
        return {
          text: "Nothing is queued for you right now. Your worklist is empty, which either means you are genuinely clear or nothing has been assigned to you yet.",
        };
      }
      const lines = tasks.map((t, i) => `${i + 1}. ${t.title}${t.expectedImpactInr ? ` (${formatInrCompact(t.expectedImpactInr)})` : ""}`);
      return {
        text: `${tasks.length} ${tasks.length === 1 ? "item" : "items"} ranked by expected impact:\n\n${lines.join("\n")}\n\nThe top item is ranked there because: ${tasks[0].priorityReason ?? "no reason recorded"}`,
        evidence: tasks.map((t) => ({
          label: t.title,
          detail: t.lead ? `${t.lead.name} · ${t.lead.company}` : (t.deal?.title ?? undefined),
          href: t.lead ? `/leads/${t.lead.id}` : "/my-queue",
        })),
      };
    },
  },
  {
    name: "search_leads",
    riskClass: "READ",
    description: "Highest-scoring leads, optionally filtered by intent.",
    match: [/hottest/i, /hot lead/i, /best lead/i, /top lead/i, /show.*lead/i, /high.?intent/i],
    implemented: true,
    run: async (ctx) => {
      const leads = await db.lead.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          archivedAt: null,
          ...leadVisibilityFilter(ctx),
          intent: { in: ["HOT", "BUYING"] },
        },
        orderBy: { score: { composite: "desc" } },
        take: 6,
        select: {
          id: true,
          tier: true,
          intent: true,
          surfacedReason: true,
          person: {
            select: {
              fullName: true,
              employments: { where: { isCurrent: true }, take: 1, select: { title: true } },
            },
          },
          company: { select: { name: true } },
          score: { select: { displayScore: true } },
        },
      });

      if (leads.length === 0) {
        return {
          text: "No leads are currently hot or buying. That is a real answer, not a gap — nothing in your workspace shows strong enough intent right now.",
        };
      }

      return {
        text: `${leads.length} ${leads.length === 1 ? "lead is" : "leads are"} hot or actively buying:\n\n${leads
          .map(
            (l) =>
              `• ${l.person.fullName} — ${l.person.employments[0]?.title ?? "role unknown"} at ${l.company.name} · ${Number(l.score?.displayScore ?? 0)}/10 · Tier ${l.tier}`
          )
          .join("\n")}`,
        evidence: leads.map((l) => ({
          label: `${l.person.fullName} · ${l.company.name}`,
          detail: l.surfacedReason,
          href: `/leads/${l.id}`,
        })),
      };
    },
  },
  {
    name: "get_pipeline",
    riskClass: "READ",
    description: "Stalled deals and deals missing a next step.",
    match: [/stalled/i, /stuck/i, /at risk/i, /pipeline/i, /deals? need/i],
    implemented: true,
    run: async (ctx) => {
      const ownerScope = leadVisibilityFilter(ctx).ownerId
        ? { ownerId: leadVisibilityFilter(ctx).ownerId }
        : {};
      const deals = await db.deal.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          status: "OPEN",
          ...ownerScope,
          risks: { some: { resolvedAt: null } },
        },
        orderBy: { valueInr: "desc" },
        take: 8,
        include: {
          company: { select: { name: true } },
          stage: { select: { name: true } },
          risks: { where: { resolvedAt: null } },
        },
      });

      if (deals.length === 0) {
        return { text: "No open deal currently has a risk flag. Every open deal has recent activity and a scheduled next step." };
      }

      const total = deals.reduce((s, d) => s + Number(d.valueInr), 0);
      return {
        text: `${deals.length} open ${deals.length === 1 ? "deal has" : "deals have"} a risk flag, worth ${formatInrCompact(total)} in total:\n\n${deals
          .map((d) => `• ${d.company.name} — ${formatInrCompact(Number(d.valueInr))} in ${d.stage.name}: ${d.risks[0].title}`)
          .join("\n")}`,
        evidence: deals.map((d) => ({
          label: `${d.company.name} — ${formatInrCompact(Number(d.valueInr))}`,
          detail: d.risks.map((r) => r.title).join("; "),
          href: "/pipeline",
        })),
      };
    },
  },
  {
    name: "get_replies",
    riskClass: "READ",
    description: "Conversations where someone replied and is waiting on you.",
    match: [/replie/i, /reply/i, /respond/i, /who.*answer/i, /inbox/i],
    implemented: true,
    run: async (ctx) => {
      const conversations = await db.conversation.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          state: { in: ["NEEDS_YOU", "OPEN"] },
          messages: { some: { direction: "INBOUND" } },
        },
        orderBy: { lastMessageAt: "desc" },
        take: 8,
        include: {
          lead: {
            select: { id: true, person: { select: { fullName: true } }, company: { select: { name: true } } },
          },
        },
      });

      if (conversations.length === 0) {
        return { text: "Nobody has replied and been left waiting. Your inbox is clear of open threads." };
      }

      return {
        text: `${conversations.length} ${conversations.length === 1 ? "conversation has" : "conversations have"} an inbound reply:\n\n${conversations
          .map(
            (c) =>
              `• ${c.lead?.person.fullName ?? "Unknown"} at ${c.lead?.company.name ?? "unknown company"} — last message ${formatAge(c.lastMessageAt)}${c.state === "NEEDS_YOU" ? " (needs you)" : ""}`
          )
          .join("\n")}`,
        evidence: conversations.map((c) => ({
          label: `${c.lead?.person.fullName ?? "Unknown"} · ${c.lead?.company.name ?? ""}`,
          detail: c.aiSummary ?? undefined,
          href: c.lead ? `/leads/${c.lead.id}` : "/inbox",
        })),
      };
    },
  },
  {
    name: "get_revenue",
    riskClass: "READ",
    description: "Open, weighted, commit and at-risk revenue.",
    match: [/revenue/i, /forecast/i, /how much.*pipeline/i, /weighted/i, /commit/i, /at risk/i],
    implemented: true,
    run: async (ctx) => {
      const r = await getRevenueInReach(ctx);
      return {
        text: [
          `Open pipeline: ${formatInrCompact(r.pipelineInr)} across ${r.openDealCount} deals.`,
          `Weighted by stage probability: ${formatInrCompact(r.weightedInr)}.`,
          `Commit (late stage, high confidence): ${formatInrCompact(r.commitInr)}.`,
          `At risk: ${formatInrCompact(r.atRiskInr)} across ${r.atRiskDealCount} flagged deals.`,
          `Won in the last 30 days: ${formatInrCompact(r.wonLast30DaysInr)} from ${r.wonLast30DaysCount} deals.`,
          "",
          "Weighted is a statistical figure from stage probabilities. Commit is the narrower number — late-stage deals you have actually called.",
        ].join("\n"),
        evidence: [
          { label: `${r.openDealCount} open deals`, href: "/pipeline" },
          { label: `${r.atRiskDealCount} deals with a risk flag`, href: "/pipeline" },
        ],
      };
    },
  },
  {
    name: "get_insights",
    riskClass: "READ",
    description: "Sales health score and its weakest dimensions.",
    match: [/health/i, /how am i doing/i, /how are we doing/i, /performance/i, /what.*wrong/i],
    implemented: true,
    run: async (ctx) => {
      const h = await getSalesHealth(ctx);
      return {
        text: `Sales health is ${h.score}/100 — ${h.band}.\n\nWeakest dimensions:\n${h.weakest
          .map((w) => `• ${w.label} (${w.value}/100): ${w.explain}`)
          .join("\n")}`,
        evidence: h.dimensions.map((d) => ({ label: `${d.label}: ${d.value}/100`, detail: d.explain })),
      };
    },
  },

  // ---- Declared but not implemented. Named so the surface is honest. -------
  {
    name: "add_note",
    riskClass: "WRITE",
    description:
      "Write a note on a lead, company or deal. Goes through the same service a person uses, so it lands on the timeline with the agent named as the actor.",
    match: [/add.*note/i, /write.*note/i, /log.*note/i],
    implemented: true,
    input: createNoteSchema,
    leadIdOf: (input) => (input as { leadId?: string }).leadId,
    execute: async (ctx, input) => {
      const parsed = input as z.infer<typeof createNoteSchema>;
      const note = await createNote(ctx, parsed);
      return {
        text: "Note added.",
        evidence: [
          {
            label: note.body.slice(0, 140),
            detail: note.isPinned ? "Pinned to the top of the timeline" : undefined,
            // The service returns the note without its parent ids, so the
            // link comes from what was asked for.
            href: parsed.leadId ? `/leads/${parsed.leadId}` : undefined,
          },
        ],
      };
    },
  },
  {
    name: "create_task",
    riskClass: "WRITE",
    description:
      "Create a task on a lead or deal. Ranked into the worklist by the same rules as any other task, so an agent cannot jump the queue.",
    match: [/create.*task/i, /add.*task/i, /remind me/i],
    implemented: true,
    input: createTaskSchema,
    leadIdOf: (input) => (input as { leadId?: string }).leadId,
    execute: async (ctx, input) => {
      const parsed = input as z.input<typeof createTaskSchema>;
      const task = await createTask(ctx, parsed);
      return {
        text: `Task created: ${task.title}`,
        evidence: [
          {
            label: task.title,
            detail: task.dueAt ? `Due ${new Date(task.dueAt).toDateString()}` : "No due date",
            href: parsed.leadId ? `/leads/${parsed.leadId}` : "/my-queue",
          },
        ],
      };
    },
  },
  {
    name: "update_deal",
    riskClass: "WRITE",
    description:
      "Change a deal's value, forecast, close date or next action. Stage moves are deliberately not here — moving a deal is a judgement about a person's intent, not a field edit.",
    match: [/update.*deal/i, /change.*deal/i, /deal value/i],
    implemented: true,
    input: z.object({ dealId: z.string().uuid() }).and(updateDealSchema),
    execute: async (ctx, input) => {
      const { dealId, ...changes } = input as { dealId: string } & z.infer<
        typeof updateDealSchema
      >;
      const deal = await updateDeal(ctx, dealId, changes);
      return {
        text: `Updated ${deal.title}.`,
        evidence: [
          {
            label: deal.title,
            detail: `Now ${formatInr(Number(deal.valueInr))}`,
            href: `/pipeline`,
          },
        ],
      };
    },
  },
  {
    name: "unlock_contacts",
    riskClass: "SPEND",
    description:
      "Reveal a lead's verified contact details. Costs points, and only for details that can actually be returned — a failed verification is refunded.",
    match: [/unlock/i, /reveal.*contact/i, /get.*email/i, /phone number/i],
    implemented: true,
    input: z.object({
      leadId: z.string().uuid(),
      contactMethodIds: z.array(z.string().uuid()).max(20).optional(),
      idempotencyKey: z.string().min(8).max(200).optional(),
    }),
    leadIdOf: (input) => (input as { leadId: string }).leadId,
    // Priced before it runs, because the guardrails decide on the cost.
    priceOf: async (ctx, input) => {
      const { leadId } = input as { leadId: string };
      const quote = await quoteReveal(ctx, leadId);
      return quote.cost;
    },
    execute: async (ctx, input) => {
      const { leadId, contactMethodIds, idempotencyKey } = input as {
        leadId: string;
        contactMethodIds?: string[];
        idempotencyKey?: string;
      };
      const result = await revealContacts(ctx, leadId, { contactMethodIds, idempotencyKey });
      return {
        text: `Revealed ${result.revealed.length} ${result.revealed.length === 1 ? "detail" : "details"} for ${result.pointsSpent} ${result.pointsSpent === 1 ? "point" : "points"}.`,
        evidence: [
          ...result.revealed.map((r) => ({
            label: r.value,
            detail: `${r.kind} · ${r.status.toLowerCase()}`,
            href: `/leads/${leadId}`,
          })),
          // Skips are evidence too: they are what was *not* charged for.
          ...result.skipped.map((skip) => ({
            label: `${skip.kind} not returned`,
            detail: skip.reason,
          })),
        ],
      };
    },
  },
  {
    name: "research_company",
    riskClass: "SPEND",
    description: "Run a deep research report. Costs points.",
    match: [/research/i, /dossier/i, /tell me about.*company/i],
    implemented: false,
  },
  {
    name: "draft_outreach",
    riskClass: "WRITE",
    description: "Draft an email, WhatsApp or LinkedIn message.",
    match: [/draft/i, /write.*(email|message)/i, /compose/i],
    implemented: false,
  },
  {
    name: "send_email",
    riskClass: "EXTERNAL",
    description: "Send an email to a prospect. Always requires approval.",
    match: [/send.*email/i, /email them/i],
    implemented: false,
  },
  {
    name: "send_whatsapp",
    riskClass: "EXTERNAL",
    description: "Send a WhatsApp message. Always requires approval.",
    match: [/whatsapp/i, /send.*whatsapp/i],
    implemented: false,
  },
];

/** Picks the best-matching tool. Later, a model does this; the contract is the same. */
export function routeQuestion(question: string): Tool | null {
  let best: { tool: Tool; hits: number } | null = null;
  for (const tool of TOOLS) {
    const hits = tool.match.filter((re) => re.test(question)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { tool, hits };
  }
  return best?.tool ?? null;
}
