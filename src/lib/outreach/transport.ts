import "server-only";
import { buildMessage, messageId, type OutgoingEmail } from "@/lib/outreach/mime";
import { activeEmailProvider, type EmailProviderName } from "@/lib/outreach/provider";
import { sendViaSmtp, type SmtpConfig } from "@/lib/outreach/adapters/smtp";
import { sendMime, type MailProvider, type MailTokens } from "@/lib/outreach/adapters/oauth-mail";
import { ProviderRequestError } from "@/lib/providers/provider-errors";
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
  | { ok: true; providerMessageId: string; adapter: EmailProviderName | MailboxAdapter }
  | {
      ok: false;
      code: SendFailure;
      reason: string;
      /** Whether the same message could succeed later, unchanged. */
      retryable: boolean;
      adapter: EmailProviderName | MailboxAdapter | null;
    };

/** A workspace mailbox's own route, as opposed to the server relay. */
export type MailboxAdapter = "mailbox_smtp" | "gmail_api" | "graph_api";
export type SendRoute =
  | { kind: "relay" }
  | { kind: "smtp"; config: SmtpConfig }
  | { kind: "oauth"; provider: MailProvider; tokens: MailTokens; workspaceId: string };

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

/**
 * Sends through a chosen route: the server relay, or a workspace mailbox (its own SMTP server,
 * or Gmail / Microsoft Graph over OAuth). Never throws, and says whether retrying could help —
 * for the OAuth APIs a server error is not retried, because the provider may have accepted it.
 */
export async function sendEmailVia(email: OutgoingEmail, route: SendRoute): Promise<SendOutcome> {
  if (route.kind === "relay") return sendEmail(email);
  if (route.kind === "smtp") {
    const r = await sendViaSmtp(email, route.config);
    if (!r.ok && r.code === "auth_failed") return { ...r, adapter: "mailbox_smtp", reason: r.reason.replace("until SMTP_URL is corrected", "until the mailbox's SMTP password is corrected in Settings → Email Accounts") };
    return { ...r, adapter: "mailbox_smtp" };
  }
  const adapter: MailboxAdapter = route.provider === "gmail" ? "gmail_api" : "graph_api";
  const id = messageId(email.from.email.split("@")[1] ?? "localhost");
  try {
    const used = await sendMime(route.workspaceId, route.provider, route.tokens, buildMessage(email, { messageId: id }), id);
    return { ok: true, providerMessageId: used, adapter };
  } catch (err) {
    const status = err instanceof ProviderRequestError ? err.status : null;
    const who = route.provider === "gmail" ? "Gmail" : "Microsoft";
    if (status === 401 || status === 403) return { ok: false, code: "auth_failed", reason: `${who} refused the mailbox's sign-in (HTTP ${status}). Reconnect it in Settings → Email Accounts. Nothing was sent.`, retryable: false, adapter };
    if (status === 429) return { ok: false, code: "temporary", reason: `${who} is rate-limiting this mailbox. Nothing was sent yet; it will be tried again.`, retryable: true, adapter };
    if (status === 400) return { ok: false, code: "permanent", reason: `${who} refused the message as malformed (HTTP 400). Nothing was sent.`, retryable: false, adapter };
    if (status !== null && status >= 500) return { ok: false, code: "permanent", reason: `${who} returned a server error (HTTP ${status}). It may or may not have been sent — check the mailbox's Sent folder before sending again. Not retried automatically.`, retryable: false, adapter };
    return { ok: false, code: "connection_failed", reason: `${who} could not be reached. Nothing was sent; it will be tried again.`, retryable: true, adapter };
  }
}
