import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { leadVisibilityFilter } from "@/lib/auth/context";

/**
 * A battlecard for one lead, assembled — not written. Every point is a row:
 * a signal on the lead, a Knowledge Base entry, or a note your team wrote, and
 * it says which. No model runs here, so nothing on it can be invented; the
 * draft buttons are where a model turns this evidence into prose.
 *
 * Relevance is plain word overlap between an entry and the lead's own signals,
 * technology and industry. Entries with no overlap are still shown, after the
 * matching ones, because a short Knowledge Base is better shown than hidden.
 */

export type BattlecardPoint = { text: string; source: { kind: "signal" | "knowledge" | "note"; id: string; label: string }; relevant: boolean };
export type Battlecard = {
  pain: BattlecardPoint[];
  talkingPoints: BattlecardPoint[];
  objections: BattlecardPoint[];
  proof: BattlecardPoint[];
  competitors: BattlecardPoint[];
  missing: string[];
};

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "your", "their", "have", "are", "was", "our", "you", "they", "into", "about", "will", "has", "its", "not", "but", "all", "can"]);
const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
const overlaps = (text: string, vocab: Set<string>) => [...words(text)].some((w) => vocab.has(w));
const clip = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function getBattlecard(ctx: AuthContext, leadId: string): Promise<Battlecard | null> {
  const lead = await db.lead.findFirst({
    where: { id: leadId, workspaceId: ctx.workspaceId, deletedAt: null, ...leadVisibilityFilter(ctx) },
    select: {
      company: { select: { industry: true, technologies: true } },
      signals: { where: { deletedAt: null }, orderBy: { occurredAt: "desc" }, take: 8, select: { id: true, type: true, title: true, excerpt: true, sourceName: true } },
      notes: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, body: true } },
    },
  });
  if (!lead) return null;
  const knowledge = await db.knowledgeDoc.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null, isActive: true },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: { id: true, kind: true, title: true, body: true },
  });

  const vocab = words([...lead.signals.map((s) => `${s.title} ${s.excerpt}`), ...lead.company.technologies, lead.company.industry ?? ""].join(" "));
  const fromKnowledge = (kinds: string[]) =>
    knowledge
      .filter((k) => kinds.includes(k.kind))
      .map((k) => ({ text: clip(`${k.title}: ${k.body}`), source: { kind: "knowledge" as const, id: k.id, label: k.title }, relevant: overlaps(`${k.title} ${k.body}`, vocab) }))
      .sort((a, b) => Number(b.relevant) - Number(a.relevant))
      .slice(0, 5);

  const pain = lead.signals
    .filter((s) => s.type !== "COMPETITOR_MENTION")
    .slice(0, 4)
    .map((s) => ({ text: clip(`${s.title} — ${s.excerpt}`), source: { kind: "signal" as const, id: s.id, label: s.sourceName }, relevant: true }));
  const competitors = [
    ...lead.signals.filter((s) => s.type === "COMPETITOR_MENTION").map((s) => ({ text: clip(`${s.title} — ${s.excerpt}`), source: { kind: "signal" as const, id: s.id, label: s.sourceName }, relevant: true })),
    ...lead.notes.filter((n) => /\b(competitor|incumbent|vs\.?|versus|switch(ing)? from)\b/i.test(n.body)).map((n) => ({ text: clip(n.body), source: { kind: "note" as const, id: n.id, label: "Team note" }, relevant: true })),
  ];

  const card: Battlecard = {
    pain,
    talkingPoints: fromKnowledge(["service", "pricing"]),
    objections: fromKnowledge(["objection", "battlecard"]),
    proof: fromKnowledge(["case_study"]),
    competitors,
    missing: [],
  };
  if (!card.pain.length) card.missing.push("No signals on this lead, so there is no evidenced pain to lead with.");
  if (!card.talkingPoints.length) card.missing.push("No Service or Pricing entries in the Knowledge Base, so there is nothing approved to say about what you sell.");
  if (!card.objections.length) card.missing.push("No Objection or Battlecard entries in the Knowledge Base.");
  if (!card.proof.length) card.missing.push("No Case study entries in the Knowledge Base — add one before promising results.");
  return card;
}
