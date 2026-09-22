/**
 * The kinds of thing a knowledge base holds.
 *
 * Shared client/server, so no DB imports here — the editor needs the same list
 * the service validates against, and a second copy in the component is how the
 * two drift apart.
 */

export const KNOWLEDGE_KINDS = [
  "service",
  "pricing",
  "case_study",
  "battlecard",
  "objection",
] as const;

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/**
 * What each kind is *for*. Shown in the editor rather than in documentation,
 * because the difference between a service page and a battlecard is the whole
 * reason to separate them.
 */
export const KNOWLEDGE_KIND: Record<
  KnowledgeKind,
  { label: string; purpose: string; prompt: string }
> = {
  service: {
    label: "Service",
    purpose: "Something you actually sell, with its real scope and boundaries.",
    prompt:
      "Name the deliverable, the typical duration and price band, and — just as importantly — what it does not include.",
  },
  pricing: {
    label: "Pricing",
    purpose: "How you price, so a draft never invents a number.",
    prompt: "Give the model, the bands and what moves a quote up or down.",
  },
  case_study: {
    label: "Case study",
    purpose: "Work you have done, with the outcome that was actually measured.",
    prompt:
      "Client size and sector, the problem, what you did, and the result with its timeframe. Say if the reference is anonymised.",
  },
  battlecard: {
    label: "Battlecard",
    purpose: "Where you win and lose against a named alternative.",
    prompt: "Be honest about where you lose — a battlecard that only wins is useless in a live call.",
  },
  objection: {
    label: "Objection",
    purpose: "A objection you hear repeatedly, and the answer that works.",
    prompt: "Write the objection in the prospect's words, then the response you would actually say.",
  },
};

export function kindLabel(kind: string): string {
  return KNOWLEDGE_KIND[kind as KnowledgeKind]?.label ?? kind;
}

export function isKnowledgeKind(value: string): value is KnowledgeKind {
  return (KNOWLEDGE_KINDS as readonly string[]).includes(value);
}
