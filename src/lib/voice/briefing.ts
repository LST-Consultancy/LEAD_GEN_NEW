/**
 * Spoken scripts, built only from counts and titles that come from rows — nothing is invented and
 * no model writes the numbers. Pure.
 */
export type BriefingInput = { firstName: string; clauses: { text: string }[]; worklist: { title: string; reason: string | null }[]; totalChanges: number };

export function briefingScript(b: BriefingInput): string {
  const parts = [`Good morning, ${b.firstName}.`];
  if (!b.clauses.length) parts.push("Nothing changed overnight that needs you.");
  else parts.push(`Since yesterday: ${b.clauses.map(c => c.text).join("; ")}.`);
  if (b.worklist.length) {
    parts.push(`Your top ${b.worklist.length === 1 ? "item" : `${b.worklist.length} items`} today:`);
    b.worklist.forEach((w, i) => parts.push(`${i + 1}. ${w.title}${w.reason ? `, because ${w.reason.replace(/\.$/, "")}` : ""}.`));
  } else parts.push("Your worklist is empty.");
  parts.push("That's the briefing.");
  return parts.join(" ").replace(/\s+/g, " ").slice(0, 4000);
}

/** A short personal voice note to a lead, for the seller to review, record or send themselves. */
export function voiceNoteScript(v: { leadFirstName: string; company: string; senderName: string; senderCompany: string; reason: string | null }) {
  return [
    `Hi ${v.leadFirstName}, this is ${v.senderName} from ${v.senderCompany}.`,
    v.reason ? `I noticed ${v.reason.replace(/^(they |the company )/i, "").replace(/\.$/, "")}, and thought it was worth a quick message.` : `I wanted to reach out to you and the team at ${v.company}.`,
    "If it's useful, I'd be glad to share how we've helped teams in a similar spot. No pressure at all — just reply whenever suits you.",
    "Thanks, and have a good day.",
  ].join(" ");
}
