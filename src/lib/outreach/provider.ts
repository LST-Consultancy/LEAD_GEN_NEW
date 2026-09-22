/**
 * §87 — the send-side provider abstraction, mirroring `lib/ai/provider.ts`.
 *
 * Nothing in the product talks to an ESP SDK directly. With no provider
 * configured, `isEmailConfigured()` is false and every send path must refuse
 * *before* it writes anything, saying plainly that nothing was sent (§126).
 *
 * This file is deliberately free of `server-only` so the UI can describe the
 * provider landscape without a round trip. It reads no secrets — only whether
 * one is present.
 */

export type EmailProviderName = "smtp" | "resend" | "ses" | "postmark" | "gmail" | "outlook";

export type ProviderDescriptor = {
  name: EmailProviderName;
  label: string;
  /** What it is good at, in a sentence a user can act on. */
  suits: string;
  /** Exactly what has to exist before this provider can send. */
  requires: string;
  /**
   * Whether this provider can also *receive*. A sequence engine that can send
   * but not read replies cannot honour stop-on-reply, which is the single most
   * important safety rule in outbound.
   */
  canReceive: boolean;
};

export const EMAIL_PROVIDERS: Record<EmailProviderName, ProviderDescriptor> = {
  gmail: {
    name: "gmail",
    label: "Gmail / Google Workspace",
    suits:
      "Sending as yourself from your own mailbox. Best reply rates, and replies land where you already read them.",
    requires: "OAuth consent for the Gmail API with send and read scopes.",
    canReceive: true,
  },
  outlook: {
    name: "outlook",
    label: "Outlook / Microsoft 365",
    suits: "The same, for Microsoft mailboxes.",
    requires: "An Entra ID app registration with Mail.Send and Mail.Read.",
    canReceive: true,
  },
  smtp: {
    name: "smtp",
    label: "SMTP relay",
    suits: "Any mailbox that speaks SMTP. Simple, and works with self-hosted mail.",
    requires: "Host, port, username and password, plus IMAP details to read replies.",
    canReceive: true,
  },
  resend: {
    name: "resend",
    label: "Resend",
    suits: "Transactional volume from a verified domain, with delivery webhooks.",
    requires: "An API key and a domain with SPF and DKIM published.",
    canReceive: false,
  },
  ses: {
    name: "ses",
    label: "Amazon SES",
    suits: "High volume at low cost, once out of the sandbox.",
    requires: "IAM credentials, a verified identity, and production access granted.",
    canReceive: false,
  },
  postmark: {
    name: "postmark",
    label: "Postmark",
    suits: "Strong deliverability reporting and fast bounce handling.",
    requires: "A server token and a verified sender signature.",
    canReceive: false,
  },
};

function credentialFor(provider: EmailProviderName): string | undefined {
  const value = {
    smtp: process.env.SMTP_URL,
    resend: process.env.RESEND_API_KEY,
    ses: process.env.AWS_SES_ACCESS_KEY_ID,
    postmark: process.env.POSTMARK_SERVER_TOKEN,
    gmail: process.env.GOOGLE_OAUTH_CLIENT_ID,
    outlook: process.env.MICROSOFT_OAUTH_CLIENT_ID,
  }[provider];
  return value && value.length > 0 ? value : undefined;
}

export function activeEmailProvider(): EmailProviderName | null {
  const named = process.env.EMAIL_PROVIDER as EmailProviderName | undefined;
  if (named && named in EMAIL_PROVIDERS && credentialFor(named)) return named;
  // Fall back to whichever one happens to be credentialled, so a single env
  // var is enough to get going.
  const found = (Object.keys(EMAIL_PROVIDERS) as EmailProviderName[]).find(credentialFor);
  return found ?? null;
}

export function isEmailConfigured(): boolean {
  return activeEmailProvider() !== null;
}

/** Whether replies can be read, which gates sequence enrollment. */
export function canReceiveReplies(): boolean {
  const active = activeEmailProvider();
  return active !== null && EMAIL_PROVIDERS[active].canReceive;
}

export const EMAIL_NOT_CONFIGURED =
  "No email provider is connected, so nothing can be sent yet. Everything else on this " +
  "screen is real — the sequence, its steps, the send window and the suppression checks all " +
  "run and are recorded. Connect a mailbox in Settings → Email Accounts to start sending.";

export const REPLIES_NOT_READABLE =
  "The connected provider can send but cannot read replies, so stop-on-reply cannot be " +
  "honoured automatically. Enrolling leads is blocked until a mailbox that supports reading " +
  "is connected, because a sequence that keeps emailing someone who already answered is the " +
  "fastest way to lose them.";
