import "server-only";
import { formatAddress, type OutgoingEmail } from "@/lib/outreach/mime";
import type { SendOutcome } from "@/lib/outreach/transport";

/**
 * §48 — Resend, over its HTTP API.
 *
 * Plain `fetch`, matching the AI adapter: an SDK for one POST is surface
 * without benefit. Resend composes the MIME itself, so this hands it the parts
 * rather than the built message.
 *
 * Worth remembering when reading the screens: Resend can send but cannot read
 * replies, so enrolling a lead in a sequence stays blocked on it. A sequence
 * that keeps emailing someone who already answered is the fastest way to lose
 * them, and no send-side adapter fixes that.
 */
export async function sendViaResend(email: OutgoingEmail): Promise<SendOutcome> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return {
      ok: false,
      code: "not_configured",
      reason: "RESEND_API_KEY is not set, so nothing was sent.",
      retryable: false,
      adapter: "resend",
    };
  }

  const controller = new AbortController();
  const budgetMs = Number(process.env.EMAIL_TIMEOUT_MS) || 20_000;
  const timer = setTimeout(() => controller.abort(), budgetMs);

  try {
    // Raced against a timer for the same reason `complete()` is: aborting a
    // fetch signals intent but does not guarantee the promise settles, and a
    // queue worker blocked on one send stops working through the rest.
    const response = await Promise.race([
      fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          from: formatAddress(email.from),
          to: [formatAddress(email.to)],
          subject: email.subject,
          text: email.text,
          ...(email.html ? { html: email.html } : {}),
          ...(email.replyTo ? { reply_to: formatAddress(email.replyTo) } : {}),
          ...(email.headers ? { headers: email.headers } : {}),
        }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), budgetMs)
      ),
    ]);

    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return {
        ok: true,
        providerMessageId: body.id ?? "unknown",
        adapter: "resend",
      };
    }

    const text = await response.text().catch(() => "");

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: "auth_failed",
        reason: `Resend rejected the API key (${response.status}). Nothing was sent, and retrying will not help until the key is corrected.`,
        retryable: false,
        adapter: "resend",
      };
    }
    if (response.status === 422) {
      // Usually an unverified sending domain, which is a setup problem rather
      // than a transient one.
      return {
        ok: false,
        code: "rejected_sender",
        reason: `Resend refused the message: ${text.slice(0, 200)}. This is normally an unverified sending domain. Nothing was sent.`,
        retryable: false,
        adapter: "resend",
      };
    }
    if (response.status === 429 || response.status >= 500) {
      return {
        ok: false,
        code: "temporary",
        reason: `Resend returned ${response.status}. Nothing was sent yet; this one is worth retrying.`,
        retryable: true,
        adapter: "resend",
      };
    }

    return {
      ok: false,
      code: "permanent",
      reason: `Resend returned ${response.status}: ${text.slice(0, 200)}. Nothing was sent.`,
      retryable: false,
      adapter: "resend",
    };
  } catch (err) {
    const aborted = err instanceof Error && /abort|timed out/i.test(err.message);
    return {
      ok: false,
      code: aborted ? "timeout" : "connection_failed",
      reason: aborted
        ? `Resend did not answer within ${Math.round(budgetMs / 1000)} seconds. Nothing was sent.`
        : `Could not reach Resend — ${err instanceof Error ? err.message : "unknown error"}. Nothing was sent.`,
      retryable: true,
      adapter: "resend",
    };
  } finally {
    clearTimeout(timer);
  }
}
