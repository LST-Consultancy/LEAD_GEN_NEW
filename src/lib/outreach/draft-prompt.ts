import { TEMPLATE_VARIABLES } from "@/lib/outreach/template";

/**
 * §67 — the prompt for outreach drafting.
 *
 * Pure and DB-free so it can be read, tested and argued about without running
 * anything. The grounding rules are the whole design:
 *
 *  - **It may only claim what the Knowledge Base says you sell.** A draft that
 *    invents a capability, a price or a timeline is worse than no draft: the
 *    prospect replies to it, and now someone has to walk it back.
 *  - **It may only reference signals that exist on the lead.** "I saw you're
 *    hiring" is a lie if nothing says so, and it is the exact lie that gets a
 *    domain blocked.
 *  - **It writes `{{variables}}`, not values.** The renderer substitutes them
 *    at send time against the real row, so a draft reviewed today still
 *    addresses the right person if the contact changes before it goes.
 */

export type DraftChannel = "email" | "whatsapp" | "linkedin" | "call";

/** Writing language. English is the default and says so; the others are asked for. */
export type DraftLanguage = "en" | "hinglish" | "hi";

export const LANGUAGE_RULES: Record<DraftLanguage, { label: string; rule: string }> = {
  en: { label: "English", rule: "Indian English." },
  hinglish: { label: "Hinglish", rule: "Hinglish: conversational Hindi and English mixed the way Indian professionals write to each other, in Latin script. Keep business terms in English." },
  hi: { label: "Hindi", rule: "Hindi in Devanagari script. Keep product names, company names and business terms that are normally said in English in English." },
};

export const CHANNEL_RULES: Record<DraftChannel, { label: string; rule: string; maxWords: number }> = {
  email: {
    label: "Email",
    rule: "A subject line under nine words, then a body of three short paragraphs at most. No greeting beyond the first line, no signature block — the sender's details are appended separately.",
    maxWords: 120,
  },
  whatsapp: {
    label: "WhatsApp",
    rule: "One message, under sixty words, no subject line. It will be read on a phone between other things. Never open with a paragraph.",
    maxWords: 60,
  },
  linkedin: {
    label: "LinkedIn",
    rule: "A connection note or short message under fifty words. No subject line. It sits in a crowded inbox next to recruiters, so the first clause has to earn the second.",
    maxWords: 50,
  },
  call: {
    label: "Call opener",
    rule: "What the caller says in the first twenty seconds of a cold call: who they are, the one specific reason for calling taken from GROUNDING, then a single open question. Spoken, not written — short sentences, no subject line, no list.",
    maxWords: 70,
  },
};

export const SYSTEM_PROMPT = `You draft first-contact outreach for an Indian B2B sales team.

You will be given GROUNDING — what this company actually sells, and what is on
record about one prospect. You may use nothing else.

Hard rules:
- Never claim a capability, price, timeline or result that is not in GROUNDING.
  If the knowledge base does not mention something, this company does not sell
  it, and saying otherwise creates a promise someone has to honour.
- Never reference a signal, event or detail about the prospect that is not in
  GROUNDING. Do not infer one from the industry or the job title.
- If GROUNDING is too thin to write something specific, say so in one sentence
  instead of writing something generic. A generic email is worse than none: it
  spends the one first impression available and teaches the reader to ignore
  the sender.
- Use {{variable}} placeholders for anything about the recipient. Write
  {{first_name}}, never a name. The placeholders are substituted against the
  live record when the message is sent.
- No flattery, no "I hope this finds you well", no "I wanted to reach out", no
  claim to have researched them at length.
- Write in the LANGUAGE given below. Placeholders, company names and figures
  stay exactly as written whatever the language. Money in lakh and crore where
  it appears in GROUNDING.

Return strict JSON and nothing else:
{"subject": string | null, "body": string, "variablesUsed": string[], "groundedOn": string[], "withheld": string | null}

- When GROUNDING contains "The conversation so far", you are writing a reply:
  answer what their latest message actually says or asks, in the same thread,
  and do not restart with a first-contact pitch.
- "subject" is null for channels that have none.
- "groundedOn" names the GROUNDING items you actually drew on, by their heading.
- "withheld" is a sentence naming what you could not say for lack of grounding,
  or null if nothing was held back.`;

/** The variables a draft is allowed to emit, listed for the model. */
export function variableVocabulary(): string {
  return TEMPLATE_VARIABLES.map((v) => `{{${v.key}}} — ${v.source}`).join("\n");
}

export type GroundingSection = { heading: string; lines: string[] };

/**
 * Assembles the prompt.
 *
 * Grounding goes *before* the instruction to write, so the model reads the
 * evidence before it has an angle to defend.
 */
export function buildDraftPrompt(input: {
  channel: DraftChannel;
  sections: GroundingSection[];
  angle?: string;
  language?: DraftLanguage;
}): string {
  const channel = CHANNEL_RULES[input.channel];
  const language = LANGUAGE_RULES[input.language ?? "en"];
  const grounding = input.sections
    .filter((s) => s.lines.length > 0)
    .map((s) => `## ${s.heading}\n${s.lines.map((l) => `- ${l}`).join("\n")}`)
    .join("\n\n");

  return [
    "GROUNDING (everything you are permitted to use):",
    grounding || "(nothing on record)",
    "",
    "AVAILABLE PLACEHOLDERS:",
    variableVocabulary(),
    "",
    `CHANNEL: ${channel.label}. ${channel.rule} Stay under ${channel.maxWords} words.`,
    `LANGUAGE: ${language.rule}`,
    input.angle ? `ANGLE THE SENDER ASKED FOR: ${input.angle}` : "",
    "",
    "Write the draft.",
  ]
    .filter(Boolean)
    .join("\n");
}

export type ParsedDraft = {
  subject: string | null;
  body: string;
  variablesUsed: string[];
  groundedOn: string[];
  withheld: string | null;
};

/**
 * Reads the model's JSON.
 *
 * Tolerant of a fenced code block, because models wrap JSON in one often
 * enough that failing on it would make the feature flaky for no reason.
 * Returns null rather than throwing — the caller turns that into an honest
 * "nothing was generated".
 */
export function parseDraft(raw: string): ParsedDraft | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  const obj = value as Record<string, unknown>;
  if (typeof obj.body !== "string" || obj.body.trim().length === 0) return null;

  return {
    subject: typeof obj.subject === "string" && obj.subject.trim() ? obj.subject.trim() : null,
    body: obj.body.trim(),
    variablesUsed: Array.isArray(obj.variablesUsed)
      ? obj.variablesUsed.filter((v): v is string => typeof v === "string")
      : [],
    groundedOn: Array.isArray(obj.groundedOn)
      ? obj.groundedOn.filter((v): v is string => typeof v === "string")
      : [],
    withheld:
      typeof obj.withheld === "string" && obj.withheld.trim() ? obj.withheld.trim() : null,
  };
}

/**
 * Variables the draft used that the vocabulary does not define.
 *
 * A model that invents `{{pain_point}}` produces copy that renders with visible
 * braces, so this is checked before the draft is ever shown.
 */
export function unknownVariables(body: string, subject: string | null): string[] {
  const known = new Set(TEMPLATE_VARIABLES.map((v) => v.key));
  const found = new Set<string>();
  for (const source of [body, subject ?? ""]) {
    for (const m of source.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
      if (!known.has(m[1].toLowerCase())) found.add(m[1]);
    }
  }
  return [...found];
}
