import "server-only";
import type { OutgoingEmail } from "@/lib/outreach/mime";
import { activeEmailProvider, type EmailProviderName } from "@/lib/outreach/provider";
import { sendViaSmtp } from "@/lib/outreach/adapters/smtp";
import { sendViaResend } from "@/lib/outreach/adapters/resend";

/**
 * §48 — the send-side transport.
 *
 * Mirrors `lib/ai/complete.ts` exactly, and for the same reasons:
 *
 *  - **It never throws.** A relay that refuses a connection must fail one
 *    message with a reason someone can act on, not crash the worker mid-batch
 *    and leave the rest of the queue unattempted.
 *  - **A failure says whether retrying could help.** SMTP separates these for
 *    us: 4xx is temporary, 5xx is permanent. Retrying a permanent rejection is
 *    how a sender earns a reputation problem, and *not* retrying a temporary
 *    one loses a legitimate message.
 *  - **It reports which adapter answered**, so a screen can say that rather
 *    than implying every provider works.
 */

export type SendOutcome =
  | { ok: true; providerMessageId: string; adapter: EmailProviderName }
  | {
      ok: false;
      code: SendFailure;
      reason: string;
      /** Whether the same message could succeed later, unchanged. */
      retryable: boolean;
      adapter: EmailProviderName | null;
    };

export type SendFailure =
  | "not_configured"
  | "no_adapter"
  | "auth_failed"
  | "rejected_sender"
  | "rejected_recipient"
  | "temporary"
  | "permanent"
  | "timeout"
  | "connection_failed";

/** Adapters that exist, as opposed to providers the routing table knows. */
export const BUILT_ADAPTERS: EmailProviderName[] = ["smtp", "resend"];

export function isAdapterBuilt(provider: EmailProviderName | null): boolean {
  return provider !== null && BUILT_ADAPTERS.includes(provider);
}

export async function sendEmail(email: OutgoingEmail): Promise<SendOutcome> {
  const provider = activeEmailProvider();

  if (!provider) {
    return {
      ok: false,
      code: "not_configured",
      reason: "No email provider is connected, so nothing was sent.",
      retryable: false,
      adapter: null,
    };
  }

  if (!isAdapterBuilt(provider)) {
    // Credentialled but unimplemented is a different problem from
    // uncredentialled, and it has a different fix: change the provider, not
    // the key.
    return {
      ok: false,
      code: "no_adapter",
      reason: `${provider} is configured, but only ${BUILT_ADAPTERS.join(" and ")} have a delivery adapter in this version. Nothing was sent.`,
      retryable: false,
      adapter: provider,
    };
  }

  try {
    return provider === "smtp" ? await sendViaSmtp(email) : await sendViaResend(email);
  } catch (err) {
    // The adapters are written not to throw; this is the belt for the brace,
    // because a throw here would take down a whole queue batch.
    return {
      ok: false,
      code: "connection_failed",
      reason: `The ${provider} adapter failed unexpectedly: ${
        err instanceof Error ? err.message : "unknown error"
      }. Nothing was sent.`,
      retryable: true,
      adapter: provider,
    };
  }
}
