/**
 * Template rendering for outreach copy. Pure, so it is tested directly and can
 * run on either side of the network boundary.
 *
 * The design rule: **an unresolved variable is a hard failure, not an empty
 * string.** "Hi {{first_name}}," and "Hi ," are the two most recognisable
 * tells of bad automated outreach, and both come from renderers that treat a
 * missing value as blank. `render()` reports what was missing and the send path
 * refuses the message.
 */

export type TemplateVariable = {
  key: string;
  label: string;
  /** Where the value comes from, shown in the editor so the user can trust it. */
  source: string;
  example: string;
};

/**
 * The whole vocabulary. A variable not in this list is a typo, and is reported
 * as unknown rather than silently left in the body — otherwise the recipient
 * sees the braces.
 */
export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { key: "first_name", label: "First name", source: "The contact's name, first word only", example: "Priya" },
  { key: "full_name", label: "Full name", source: "The contact's name as stored", example: "Priya Menon" },
  { key: "company", label: "Company", source: "The lead's company name", example: "Vaitarna Steel Works" },
  { key: "title", label: "Job title", source: "Their current role at that company", example: "Head of IT" },
  { key: "city", label: "City", source: "The company's city", example: "Nashik" },
  { key: "industry", label: "Industry", source: "The company's industry", example: "Manufacturing" },
  { key: "signal", label: "Buying signal", source: "The most recent signal on the lead", example: "posted a job for a Salesforce administrator" },
  { key: "sender_name", label: "Your name", source: "The sending user's name", example: "Rahul Desai" },
  {
    key: "sender_first_name",
    label: "Your first name",
    source: "The sending user's name, first word only — for a sign-off",
    example: "Rahul",
  },
  { key: "sender_company", label: "Your company", source: "The workspace name", example: "Northbridge Cloud" },
];

export const VARIABLE_KEYS = new Set(TEMPLATE_VARIABLES.map((v) => v.key));

export type RenderResult =
  | { ok: true; text: string; used: string[] }
  | { ok: false; text: string; missing: string[]; unknown: string[]; used: string[] };

const TOKEN = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/**
 * Substitutes `{{variable}}` tokens. Returns `ok: false` when any token has no
 * value or is not a known variable; `text` still holds the best-effort render
 * so the UI can show exactly where the gap is.
 */
export function render(template: string, values: Record<string, string | null | undefined>): RenderResult {
  const missing: string[] = [];
  const unknown: string[] = [];
  const used: string[] = [];

  const text = template.replace(TOKEN, (whole, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (!VARIABLE_KEYS.has(key)) {
      if (!unknown.includes(key)) unknown.push(key);
      return whole;
    }
    const value = values[key];
    if (value === undefined || value === null || value.trim() === "") {
      if (!missing.includes(key)) missing.push(key);
      return whole;
    }
    if (!used.includes(key)) used.push(key);
    return value.trim();
  });

  if (missing.length > 0 || unknown.length > 0) return { ok: false, text, missing, unknown, used };
  return { ok: true, text, used };
}

/** The variables a template references, for the editor's preview and validation. */
export function variablesIn(template: string): { known: string[]; unknown: string[] } {
  const known: string[] = [];
  const unknown: string[] = [];
  for (const m of template.matchAll(TOKEN)) {
    const key = m[1].toLowerCase();
    const bucket = VARIABLE_KEYS.has(key) ? known : unknown;
    if (!bucket.includes(key)) bucket.push(key);
  }
  return { known, unknown };
}

/**
 * Cheap, deterministic copy checks — the things a reviewer would flag anyway.
 * These are advisory: they never block a send, because judging copy is the
 * user's job. Blocking belongs to the sendability rules, which are about
 * consent and delivery, not taste.
 */
export type CopyWarning = { code: string; message: string };

export function reviewCopy(subject: string, body: string): CopyWarning[] {
  const out: CopyWarning[] = [];
  const words = body.trim().split(/\s+/).filter(Boolean).length;

  if (subject.trim().length === 0) {
    out.push({ code: "no_subject", message: "No subject line. Most filters treat an empty subject as spam." });
  } else if (subject.length > 60) {
    out.push({
      code: "subject_long",
      message: `Subject is ${subject.length} characters; mobile clients cut off around 45.`,
    });
  }
  if (words > 150) {
    out.push({
      code: "body_long",
      message: `${words} words. First-touch email over ~120 words is usually skimmed and not answered.`,
    });
  }
  if (words > 0 && words < 20) {
    out.push({
      code: "body_short",
      message: `${words} words may be too thin to say why you are writing.`,
    });
  }
  if (!/\?/.test(body)) {
    out.push({
      code: "no_ask",
      message: "No question anywhere in the body, so there is nothing specific to reply to.",
    });
  }
  const shouty = subject.replace(/[^A-Z]/g, "").length;
  if (subject.length > 8 && shouty > subject.length * 0.5) {
    out.push({ code: "shouting", message: "Mostly capitals in the subject reads as bulk mail." });
  }
  if (/\b(guarantee[d]?|risk[- ]free|act now|limited time|100% free)\b/i.test(`${subject} ${body}`)) {
    out.push({
      code: "spam_phrase",
      message: "Contains a phrase spam filters score heavily. Rewording costs nothing.",
    });
  }
  if (!variablesIn(body).known.length) {
    out.push({
      code: "no_personalisation",
      message: "No variables used, so every recipient gets an identical message.",
    });
  }
  return out;
}
