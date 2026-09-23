/**
 * §93 — one place for every user-facing status word and its visual treatment.
 * Components import from here so "HOT" never means two different things.
 */

export type IntentKey = "COLD" | "AWARE" | "WARM" | "HOT" | "BUYING";

export const INTENT: Record<
  IntentKey,
  { label: string; order: number; dot: string; chip: string; text: string }
> = {
  COLD: {
    label: "Cold",
    order: 0,
    dot: "bg-intent-cold",
    chip: "bg-intent-cold-subtle text-intent-cold border-intent-cold/25",
    text: "text-intent-cold",
  },
  AWARE: {
    label: "Aware",
    order: 1,
    dot: "bg-intent-aware",
    chip: "bg-intent-aware-subtle text-intent-aware border-intent-aware/25",
    text: "text-intent-aware",
  },
  WARM: {
    label: "Warm",
    order: 2,
    dot: "bg-intent-warm",
    chip: "bg-intent-warm-subtle text-intent-warm border-intent-warm/30",
    text: "text-intent-warm",
  },
  HOT: {
    label: "Hot",
    order: 3,
    dot: "bg-intent-hot",
    chip: "bg-intent-hot-subtle text-intent-hot border-intent-hot/30",
    text: "text-intent-hot",
  },
  BUYING: {
    label: "Buying",
    order: 4,
    dot: "bg-intent-buying",
    chip: "bg-intent-buying-subtle text-intent-buying border-intent-buying/30",
    text: "text-intent-buying",
  },
};

export const INTENT_ORDER: IntentKey[] = ["COLD", "AWARE", "WARM", "HOT", "BUYING"];

export type TierKey = "A" | "B" | "C" | "D";

export const TIER: Record<TierKey, { label: string; chip: string; ring: string; meaning: string }> =
  {
    A: {
      label: "A",
      chip: "bg-tier-a text-brand-fg border-tier-a",
      ring: "ring-tier-a",
      meaning: "Bullseye ICP match — prioritise ahead of everything else.",
    },
    B: {
      label: "B",
      chip: "bg-tier-b/15 text-tier-b border-tier-b/35",
      ring: "ring-tier-b",
      meaning: "Strong fit with one or two gaps against your ICP.",
    },
    C: {
      label: "C",
      chip: "bg-tier-c/12 text-tier-c border-tier-c/30",
      ring: "ring-tier-c",
      meaning: "Plausible fit, worth nurturing rather than chasing.",
    },
    D: {
      label: "D",
      chip: "bg-tier-d/10 text-tier-d border-tier-d/25",
      ring: "ring-tier-d",
      meaning: "Outside your stated ICP. Kept for context only.",
    },
  };

export type LeadStatusKey =
  | "NEW"
  | "WORKING"
  | "CONTACTED"
  | "REPLIED"
  | "QUALIFIED"
  | "NURTURE"
  | "UNQUALIFIED";

export const LEAD_STATUS: Record<
  LeadStatusKey,
  { label: string; variant: "neutral" | "info" | "brand" | "success" | "warning" | "outline" }
> = {
  NEW: { label: "New", variant: "info" },
  WORKING: { label: "Working", variant: "brand" },
  CONTACTED: { label: "Contacted", variant: "neutral" },
  REPLIED: { label: "Replied", variant: "success" },
  QUALIFIED: { label: "Qualified", variant: "success" },
  NURTURE: { label: "Nurture", variant: "warning" },
  UNQUALIFIED: { label: "Unqualified", variant: "outline" },
};

export const DISCOVERY_STATE: Record<
  string,
  { label: string; variant: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
  QUEUED: { label: "Queued", variant: "neutral" },
  RUNNING: { label: "Searching", variant: "info" },
  COMPLETED: { label: "Completed", variant: "success" },
  PARTIAL: { label: "Partly completed", variant: "warning" },
  FAILED: { label: "Failed", variant: "danger" },
  CANCELLED: { label: "Cancelled", variant: "neutral" },
};

export const PROVIDER_RESULT_LABEL: Record<string, string> = {
  COMPLETED: "Completed",
  PARTIAL: "Partial",
  ERROR: "Error",
  NOT_CONNECTED: "Not connected",
};

/** Why a search result without a named buyer was set aside, as a plural noun phrase. */
export const SCREEN_REASON_LABEL: Record<string, string> = {
  seller_or_publisher: "seller or publisher pages",
  not_a_request: "not a project request",
  hiring_only: "job adverts, not a request for a provider",
  no_named_buyer: "no buyer named",
  not_relevant: "off topic",
  ai_unavailable: "not checked: AI unavailable",
};

export const BUYER_ATTRIBUTION_LABEL: Record<string, string> = {
  page_owner: "Buyer is the owner of the page making the request.",
  named_in_text: "Buyer named in the source text; the name and quote were checked word for word. The company's identity is not otherwise verified.",
};

export const CHANNEL_LABEL: Record<string, string> = {
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  LINKEDIN: "LinkedIn",
  PHONE: "Call",
  SMS: "SMS",
  IN_PERSON: "In person",
};

export const VERIFICATION: Record<
  string,
  { label: string; variant: "success" | "warning" | "neutral" | "danger" }
> = {
  VERIFIED: { label: "Verified", variant: "success" },
  LIKELY: { label: "Likely", variant: "warning" },
  UNVERIFIED: { label: "Unverified", variant: "neutral" },
  FAILED: { label: "Failed", variant: "danger" },
};

/**
 * What a verification state actually means depends on the channel: an email is
 * checked for deliverability, a phone number is checked for reachability, and a
 * public profile URL is only ever observed. Using one sentence for all three
 * made the UI claim things that were not true of the method in front of it.
 */
export function verificationMeaning(status: string, kind: string): string {
  const isEmail = kind === "WORK_EMAIL" || kind === "PERSONAL_EMAIL";
  const isPhone = kind === "MOBILE" || kind === "DIRECT_PHONE" || kind === "SWITCHBOARD" || kind === "WHATSAPP";
  const isProfile = kind === "LINKEDIN_URL";

  switch (status) {
    case "VERIFIED":
      if (isEmail) return "Deliverability checked against the mail provider at the date shown.";
      if (isPhone) return "Line checked as reachable at the date shown.";
      if (isProfile) return "Profile resolved successfully at the date shown.";
      return "Checked against the source at the date shown.";
    case "LIKELY":
      if (isEmail) return "Pattern-matched from a known company email format. Not individually confirmed.";
      if (isPhone) return "Matched to this person by the source, but not dialled to confirm.";
      if (isProfile) return "Matched by name and employer. Worth a glance before you rely on it.";
      return "Inferred from the source rather than individually confirmed.";
    case "FAILED":
      if (isEmail) return "Verification was attempted and the mail provider rejected it.";
      if (isPhone) return "The number was checked and found unreachable.";
      return "Verification was attempted and did not succeed.";
    default:
      if (isEmail) return "Collected but never checked. Treat with care before bulk sending.";
      return "Collected but never checked.";
  }
}

export const SIGNAL_TYPE_LABEL: Record<string, string> = {
  SOCIAL_POST: "Public post",
  SOCIAL_COMMENT: "Comment",
  HIRING: "Hiring",
  JOB_CHANGE: "Job change",
  FUNDING: "Funding",
  TECH_CHANGE: "Tech change",
  WEBSITE_UPDATE: "Website update",
  ANNOUNCEMENT: "Announcement",
  NEWS: "News",
  RFP: "RFP / tender",
  EVENT: "Event",
  REVIEW: "Review",
  COMPETITOR_MENTION: "Competitor mention",
  EMAIL_ACTIVITY: "Email activity",
  PROPOSAL_ACTIVITY: "Proposal activity",
  MEETING: "Meeting",
  MANUAL_NOTE: "Manual note",
};

export const SIGNAL_SOURCE_LABEL: Record<string, string> = {
  PUBLIC_WEB: "Public web",
  JOB_BOARD: "Job board",
  NEWS: "News",
  SOCIAL_PUBLIC: "Public social",
  COMPANY_SITE: "Company site",
  LICENSED_DATASET: "Licensed dataset",
  USER_INTEGRATION: "Your integration",
  USER_MANUAL: "Added by you",
  TENDER_PORTAL: "Tender portal",
};

export const TASK_PRIORITY: Record<
  string,
  { label: string; variant: "neutral" | "info" | "warning" | "danger" }
> = {
  LOW: { label: "Low", variant: "neutral" },
  MEDIUM: { label: "Medium", variant: "info" },
  HIGH: { label: "High", variant: "warning" },
  URGENT: { label: "Urgent", variant: "danger" },
};

export const AUTOPILOT_MODE: Record<string, { label: string; short: string; description: string }> =
  {
    OFF: {
      label: "Autopilot off",
      short: "Off",
      description: "No autonomous work. Everything waits for you.",
    },
    REVIEW_FIRST: {
      label: "Review first",
      short: "Review",
      description: "Agents prepare work and queue it for your approval before anything is sent or spent.",
    },
    FULL_AUTO: {
      label: "Full auto",
      short: "Auto",
      description:
        "Agents act inside the budgets, channels and hours you configured. Everything is still logged.",
    },
  };

/** Risk classes for AI tool calls (§63). */
export const RISK_CLASS: Record<
  string,
  { label: string; variant: "neutral" | "info" | "warning" | "danger"; rule: string }
> = {
  READ: { label: "Read", variant: "neutral", rule: "Runs without confirmation." },
  WRITE: { label: "Write", variant: "info", rule: "Changes workspace data. Permitted by role." },
  SPEND: { label: "Spends points", variant: "warning", rule: "Needs confirmation or a standing budget." },
  EXTERNAL: {
    label: "Contacts a person",
    variant: "danger",
    rule: "Needs explicit approval unless Full Auto authorises it.",
  },
};
