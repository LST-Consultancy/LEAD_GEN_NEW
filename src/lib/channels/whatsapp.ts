/**
 * §46 — WhatsApp via the official Business API.
 *
 * Mirrors `lib/outreach/provider.ts`: no `server-only`, reads no secret value,
 * only whether one is present. There is deliberately no unofficial path — a
 * library that drives WhatsApp Web gets the number banned and the account
 * terminated, and shipping one behind a toggle would be selling that risk to
 * the user without saying so.
 */

export type WhatsAppCredential = {
  key: string;
  label: string;
  /** What it is, in terms someone setting it up will recognise. */
  what: string;
  present: boolean;
};

/**
 * The rules that make WhatsApp different from email, and that no amount of
 * product design can work around. They are shown on screen because a seller
 * who learns them after their number is blocked has learned them too late.
 */
export const WHATSAPP_RULES = [
  {
    title: "You cannot cold-message",
    detail:
      "A business may only open a conversation with someone who has opted in, through a channel you can evidence. A purchased list is not opt-in. This is enforced by Meta, not by us.",
  },
  {
    title: "Outside 24 hours, only an approved template",
    detail:
      "Once a person replies, a 24-hour window opens in which you may send freely. Outside it, every message must be a template Meta has approved in advance, and it is charged per conversation.",
  },
  {
    title: "Opt-out must be honoured everywhere",
    detail:
      "A stop on WhatsApp suppresses the person across every channel here, not just this one. That is stricter than the regulation requires and deliberately so.",
  },
  {
    title: "Quality rating is per number",
    detail:
      "Blocks and reports lower a rating that caps how many people you can message a day. One careless campaign degrades the number for every later one.",
  },
] as const;

export function whatsappCredentials(): WhatsAppCredential[] {
  const present = (value: string | undefined) => Boolean(value && value.length > 0);
  return [
    {
      key: "WHATSAPP_PHONE_NUMBER_ID",
      label: "Phone number ID",
      what: "The sending number registered to your WhatsApp Business Account.",
      present: present(process.env.WHATSAPP_PHONE_NUMBER_ID),
    },
    {
      key: "WHATSAPP_BUSINESS_ACCOUNT_ID",
      label: "Business account ID",
      what: "The WABA that owns the number and its approved templates.",
      present: present(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID),
    },
    {
      key: "WHATSAPP_ACCESS_TOKEN",
      label: "Access token",
      what: "A system-user token with whatsapp_business_messaging. Short-lived tokens expire and stop sends silently.",
      present: present(process.env.WHATSAPP_ACCESS_TOKEN),
    },
    {
      key: "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
      label: "Webhook verify token",
      what: "A string you choose, echoed back during webhook verification. Without it, delivery and read receipts never arrive.",
      present: present(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    },
  ];
}

export function isWhatsAppConfigured(): boolean {
  return whatsappCredentials().every((c) => c.present);
}

/**
 * Whether the *adapter* exists, separately from whether it is credentialled.
 *
 * These are two different gaps with two different fixes, and collapsing them
 * into one "not connected" tells an admin to go and find credentials that
 * nothing would use.
 */
export const WHATSAPP_ADAPTER_BUILT = false;

export const WHATSAPP_NOT_AVAILABLE =
  "The WhatsApp adapter is not built, so nothing can be sent on this channel yet and no " +
  "credentials are required. Consent, suppression and the message record are real — a stop " +
  "recorded here already blocks every other channel.";
