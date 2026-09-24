/**
 * The sentences on a lead's verdict, each built from stored numbers.
 *
 * A dimension that was never scored is *unknown*, not zero and not a pass.
 * The earlier version compared `undefined < 40`, which is false, so a lead with
 * no score at all failed no check and was told "all evidenced".
 */
export type Dims = Partial<Record<"fit" | "intent" | "urgency" | "authority" | "budget" | "reachability" | "engagement" | "recency", number>>;

const known = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Authority as one explicit state, so the badge, verdict and next action cannot disagree. */
export type AuthorityState = "confirmed" | "title_only" | "influencer" | "unknown";
export function authorityState(d: Dims, isDecisionMaker: boolean, committeeConfirmed = false): AuthorityState {
  if (isDecisionMaker && committeeConfirmed) return "confirmed";
  if (isDecisionMaker) return "title_only";
  if (known(d.authority) && d.authority >= 50) return "influencer";
  return "unknown";
}

export function whyFit(d: Dims, authority: AuthorityState): string {
  const parts: string[] = [];
  if (!known(d.fit)) parts.push("ICP fit has not been assessed — no ICP profile has scored this lead");
  else if (d.fit >= 70) parts.push("They match your ICP closely on industry, size and location");
  else if (d.fit >= 40) parts.push("Partial ICP match — some dimensions line up, others don't");
  else parts.push("Weak ICP match on the criteria you defined");

  if (authority === "confirmed") parts.push("and this person is confirmed as able to authorise the purchase");
  else if (authority === "title_only") parts.push("and their title suggests they can authorise the purchase, which nobody has confirmed");
  else if (authority === "influencer") parts.push("and this person has meaningful influence");
  else parts.push("and whether this person can decide is unknown");
  return `${parts.join(" ")}.`;
}

export function risks(d: Dims, readiness: { state: string }[], hasReplied: boolean, budgetInr: number | null): string {
  const found: string[] = [];
  const unassessed: string[] = [];
  const check = (key: keyof Dims, label: string, fails: (v: number) => boolean, risk: string) => {
    const v = d[key];
    if (!known(v)) unassessed.push(label);
    else if (fails(v)) found.push(risk);
  };
  if (!budgetInr) check("budget", "budget", (v) => v < 40, "no budget has been confirmed");
  check("authority", "authority", (v) => v < 45, "the decision maker has not been identified");
  check("intent", "need", (v) => v < 30, "no need is evidenced");
  check("reachability", "reachability", (v) => v < 30, "there is no reliable way to contact them yet");
  if (!hasReplied && known(d.engagement) && d.engagement === 0) found.push("they have never responded to you");
  if (known(d.recency) && d.recency < 30) found.push("the evidence is going stale");
  const failing = readiness.filter((r) => r.state === "no").length;
  if (failing >= 3) found.push(`${failing} readiness checks are failing`);

  if (unassessed.length) found.push(`${unassessed.join(", ")} ${unassessed.length === 1 ? "has" : "have"} not been assessed`);
  if (found.length === 0) return "Nothing material is missing. Budget, authority, need and reachability are all evidenced.";
  return `${found[0].charAt(0).toUpperCase()}${found[0].slice(1)}${found.length > 1 ? `; ${found.slice(1).join("; ")}` : ""}.`;
}

export function angle(d: Dims, surfacedReason: string): string {
  if (known(d.urgency) && d.urgency >= 60) {
    return "Lead with their deadline, not your capability. The signal already told you what they need — reference it directly and make the first reply short enough to answer on a phone.";
  }
  if (known(d.intent) && d.intent >= 50) {
    return `Open with the specific problem named in their signal: "${surfacedReason.slice(0, 90)}${surfacedReason.length > 90 ? "…" : ""}". A comparable case study will outperform a feature list.`;
  }
  if (known(d.fit) && d.fit >= 60) {
    return "Good fit but no demonstrated intent. Add them to Radar and wait for a behavioural signal rather than spending credibility on a cold approach now.";
  }
  if (!known(d.fit) && !known(d.intent)) return "This lead has not been scored yet, so there is no evidence-based angle. Score it against an ICP first.";
  return "Not enough evidence to justify outreach. Leave them in the database and let the radar surface them if something changes.";
}

/** Readiness headline. An empty checklist is "not assessed", never a success. */
export function readinessSummary(items: { state: string }[]): { label: string; tone: "success" | "warning" | "neutral"; assessed: boolean } {
  if (items.length === 0) return { label: "Not assessed", tone: "neutral", assessed: false };
  const confirmed = items.filter((i) => i.state === "yes").length;
  return {
    label: `${confirmed}/${items.length}`,
    tone: confirmed > 0 && confirmed >= items.length - 1 ? "success" : confirmed >= 3 ? "warning" : "neutral",
    assessed: true,
  };
}
