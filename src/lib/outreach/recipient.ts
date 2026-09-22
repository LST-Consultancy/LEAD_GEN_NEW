/**
 * Choosing who a message goes to, and whether that address may be used.
 *
 * This exists because `checkSendable` only guarantees that everyone asks the
 * same *questions*. It does not stop two call sites computing the *answers*
 * differently — and they did: the engine honoured a per-contact `optedOutAt`
 * while enrollment did not, so a lead who had unsubscribed was refused with
 * "no email address on this lead" instead of the truth.
 *
 * Pure, so the resolution is tested on its own.
 */

export type ContactCandidate = {
  value: string | null;
  optedOutAt: Date | null;
  bounceCount: number;
};

export type SuppressionEntry = { reason: string; source: string };

export type ResolvedRecipient = {
  /** The address to use, or null when none may be used. */
  toAddress: string | null;
  /**
   * Why no address may be used, expressed as a suppression so `checkSendable`
   * reports "on the do-not-contact list" rather than "no address" — which are
   * very different things to tell a user.
   */
  suppression: SuppressionEntry | null;
};

/** Three hard bounces means the address is wrong, not that they are ignoring us. */
export const BOUNCE_LIMIT = 3;

export function resolveRecipient(
  contacts: ContactCandidate[],
  lookup: {
    /** Workspace-level do-not-contact match for a given address, if any. */
    listed: (address: string) => SuppressionEntry | null;
  }
): ResolvedRecipient {
  const withValue = contacts.filter((c): c is ContactCandidate & { value: string } =>
    Boolean(c.value)
  );

  const usable = withValue.find(
    (c) => c.optedOutAt === null && c.bounceCount < BOUNCE_LIMIT
  );

  if (usable) {
    return { toAddress: usable.value, suppression: lookup.listed(usable.value) };
  }

  // Nothing usable. Report the most specific reason, because "no address" and
  // "they unsubscribed" lead to completely different next steps.
  const optedOut = withValue.find((c) => c.optedOutAt !== null);
  if (optedOut) {
    return {
      toAddress: null,
      suppression: { reason: "Unsubscribed from this address", source: "contact record" },
    };
  }

  const bounced = withValue.find((c) => c.bounceCount >= BOUNCE_LIMIT);
  if (bounced) {
    return {
      toAddress: null,
      suppression: {
        reason: `Hard-bounced ${bounced.bounceCount} times, so the address is wrong`,
        source: "delivery reports",
      },
    };
  }

  return { toAddress: null, suppression: null };
}

/** Builds a `listed` lookup from a workspace's suppression rows. */
export function suppressionLookup(
  rows: { kind: string; value: string; reason: string; source: string }[]
): (address: string) => SuppressionEntry | null {
  const emails = new Map(rows.filter((r) => r.kind === "email").map((r) => [r.value, r]));
  const domains = new Map(rows.filter((r) => r.kind === "domain").map((r) => [r.value, r]));

  return (address: string) => {
    const lower = address.toLowerCase();
    const hit = emails.get(lower) ?? domains.get(lower.split("@")[1] ?? "");
    return hit ? { reason: hit.reason, source: hit.source } : null;
  };
}
