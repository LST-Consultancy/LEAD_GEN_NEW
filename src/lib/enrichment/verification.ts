/**
 * What an email check actually established. Seven outcomes, kept apart on purpose: a valid syntax
 * or a mail server for the domain is not a confirmed mailbox, a catch-all domain accepts every
 * address, and an SMTP server that refuses to answer proves nothing either way.
 */
export const CHECK_RESULTS = ["MAILBOX_CONFIRMED", "DOMAIN_VALID", "SYNTAX_VALID", "CATCH_ALL", "INVALID", "INCONCLUSIVE", "UNKNOWN"] as const;
export type CheckResult = typeof CHECK_RESULTS[number];
export type Check = { email: string; result: CheckResult; reason: string; raw: Record<string, unknown> };

export const CHECK_LABEL: Record<CheckResult | "UNCHECKED", { label: string; explain: string }> = {
  MAILBOX_CONFIRMED: { label: "Mailbox confirmed", explain: "The mail server accepted this specific address when checked. That is not a promise a message will be delivered or read." },
  DOMAIN_VALID: { label: "Domain accepts mail", explain: "The domain has mail servers, but the mailbox itself was not confirmed." },
  SYNTAX_VALID: { label: "Format valid only", explain: "The address is well formed; neither the domain nor the mailbox was confirmed." },
  CATCH_ALL: { label: "Catch-all domain", explain: "The domain accepts any address, so this mailbox cannot be confirmed." },
  INVALID: { label: "Invalid", explain: "The check found the address cannot receive mail." },
  INCONCLUSIVE: { label: "Inconclusive", explain: "The mail server blocked or did not answer the check. This is not a failure and not a confirmation." },
  UNKNOWN: { label: "Unknown", explain: "The checker returned no usable result." },
  UNCHECKED: { label: "Not checked", explain: "Found, but no check has been run." },
};

const b = (v: unknown) => (typeof v === "boolean" ? v : null);
const s = (v: unknown) => (typeof v === "string" ? v : "");

/** BounceVerify's documented fields: syntax_valid, domain_exists, mx_found, smtp_valid, is_catch_all, is_disposable, status, reason. */
function fromBounceVerify(r: Record<string, unknown>): { result: CheckResult; reason: string } {
  const reason = s(r.reason);
  if (b(r.syntax_valid) === false) return { result: "INVALID", reason: reason || "Not a valid address format." };
  if (b(r.domain_exists) === false || b(r.mx_found) === false) return { result: "INVALID", reason: reason || "The domain has no mail servers." };
  if (b(r.is_disposable) === true) return { result: "INVALID", reason: "A disposable mailbox provider." };
  if (b(r.is_catch_all) === true) return { result: "CATCH_ALL", reason: reason || "The domain accepts all addresses." };
  if (b(r.smtp_valid) === true) return { result: "MAILBOX_CONFIRMED", reason: reason || "The mail server accepted the mailbox." };
  // A refusal only counts as invalid when the server said the mailbox does not exist.
  if (b(r.smtp_valid) === false && /not exist|no such|unknown user|user unknown|mailbox unavailable|rejected|invalid mailbox|undeliverable/i.test(reason)) return { result: "INVALID", reason };
  if (b(r.smtp_valid) === false) return { result: "INCONCLUSIVE", reason: reason || "The mail server did not confirm the mailbox." };
  if (b(r.mx_found) === true) return { result: "DOMAIN_VALID", reason: reason || "Mail servers found; mailbox not checked." };
  if (b(r.syntax_valid) === true) return { result: "SYNTAX_VALID", reason: reason || "Format checked only." };
  return { result: "UNKNOWN", reason: reason || s(r.status) || "No result." };
}

/** michael.g's documented technical_status: valid, invalid, unknown ("SMTP unreachable"), catch_all, disposable. */
function fromMichaelG(r: Record<string, unknown>): { result: CheckResult; reason: string } {
  const reason = s(r.reason); const t = s(r.technical_status);
  if (s(r.error)) return { result: "UNKNOWN", reason: s(r.error) };
  if (t === "valid") return { result: "MAILBOX_CONFIRMED", reason: reason || "Mailbox confirmed." };
  if (t === "catch_all") return { result: "CATCH_ALL", reason: reason || "The domain accepts all addresses." };
  if (t === "invalid") return { result: "INVALID", reason: reason || "Syntax or mail infrastructure invalid." };
  if (t === "disposable") return { result: "INVALID", reason: "A disposable mailbox provider." };
  if (t === "unknown") return { result: "INCONCLUSIVE", reason: reason || "Mail servers exist but SMTP was unreachable." };
  return { result: "UNKNOWN", reason: reason || "No result." };
}

export function mapChecks(items: unknown[], format: "bounceverify" | "michael_g"): Check[] {
  const out: Check[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const email = s(r.email).trim().toLowerCase();
    if (!email) continue;
    const m = format === "michael_g" ? fromMichaelG(r) : fromBounceVerify(r);
    out.push({ email, ...m, raw: r });
  }
  return out;
}

/** The existing ContactMethod status column: only a confirmed mailbox is VERIFIED, only an invalid one FAILED. */
export const contactStatusFor = (r: CheckResult): "VERIFIED" | "FAILED" | "UNVERIFIED" => (r === "MAILBOX_CONFIRMED" ? "VERIFIED" : r === "INVALID" ? "FAILED" : "UNVERIFIED");
