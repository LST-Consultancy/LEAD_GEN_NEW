import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Business Cloud API (Meta Graph API), the official path. Pure: request bodies, webhook
 * parsing, signature checks and the 24-hour rule, so each is tested without Meta.
 *
 * - Send: `POST https://graph.facebook.com/{version}/{phone-number-id}/messages`, Bearer token.
 * - Webhook verification: `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` → echo challenge.
 * - Webhook events: `POST`, signed `X-Hub-Signature-256: sha256=HMAC(app secret, raw body)`;
 *   `entry[].changes[].value.messages[]` (inbound) and `.statuses[]` (sent/delivered/read/failed).
 */
export const GRAPH_HOST = "graph.facebook.com";
export const DEFAULT_API_VERSION = "v23.0";
/** Outside this window after the person's last message, only an approved template may be sent. */
export const SERVICE_WINDOW_MS = 24 * 3600 * 1000;
const STOP = /^\s*(stop|unsubscribe|opt[\s-]?out|cancel|end|quit)\s*[.!]*\s*$/i;

/** E.164 digits without the plus, as the Cloud API takes and returns numbers. Null when not a plausible number. */
export function waNumber(raw: string | null | undefined, defaultCountry = "91"): string | null {
  if (!raw) return null;
  const t = raw.trim();
  let d = t.replace(/[^\d]/g, "");
  if (!t.startsWith("+") && !t.startsWith("00") && d.length === 10) d = `${defaultCountry}${d}`;
  if (t.startsWith("00")) d = d.slice(2);
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export type OutgoingWhatsApp = { kind: "template"; name: string; language: string; params: string[] } | { kind: "text"; body: string };
export function messageBody(to: string, m: OutgoingWhatsApp) {
  return m.kind === "text"
    ? { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: m.body } }
    : { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template", template: { name: m.name, language: { code: m.language }, ...(m.params.length ? { components: [{ type: "body", parameters: m.params.map(text => ({ type: "text", text })) }] } : {}) } };
}

/** Which kind of message the rules allow now: free text inside 24 hours of their last message, else a template. */
export function allowedKind(lastInboundAt: Date | null, now = new Date()): "text_or_template" | "template_only" {
  return lastInboundAt && now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS ? "text_or_template" : "template_only";
}

/** Constant-time check of Meta's `X-Hub-Signature-256` over the exact raw body. */
export function validSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const got = header.slice(7);
  if (got.length !== expected.length || !/^[0-9a-f]+$/i.test(got)) return false;
  return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
}

export type InboundWhatsApp = { phoneNumberId: string; from: string; id: string; at: Date; text: string; type: string; optOut: boolean; name: string | null };
export type StatusWhatsApp = { phoneNumberId: string; id: string; status: "sent" | "delivered" | "read" | "failed"; at: Date; recipient: string; error: string | null };

/** The inbound messages and delivery statuses in one webhook delivery; anything unrecognised is ignored. */
export function parseWebhook(payload: unknown): { messages: InboundWhatsApp[]; statuses: StatusWhatsApp[] } {
  const out = { messages: [] as InboundWhatsApp[], statuses: [] as StatusWhatsApp[] };
  const p = (payload ?? {}) as { object?: string; entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
  if (p.object !== "whatsapp_business_account") return out;
  for (const e of p.entry ?? []) for (const c of e.changes ?? []) {
    if (c.field !== "messages" || !c.value) continue;
    const v = c.value as { metadata?: { phone_number_id?: string }; contacts?: { profile?: { name?: string }; wa_id?: string }[]; messages?: Record<string, unknown>[]; statuses?: Record<string, unknown>[] };
    const phoneNumberId = v.metadata?.phone_number_id; if (!phoneNumberId) continue;
    for (const m of v.messages ?? []) {
      const from = typeof m.from === "string" ? m.from : null; const id = typeof m.id === "string" ? m.id : null;
      if (!from || !id) continue;
      const type = typeof m.type === "string" ? m.type : "unknown";
      const text = type === "text" ? String((m.text as { body?: string } | undefined)?.body ?? "") : type === "button" ? String((m.button as { text?: string } | undefined)?.text ?? "") : type === "interactive" ? String(((m.interactive as { button_reply?: { title?: string } } | undefined)?.button_reply?.title) ?? "") : `(${type} message)`;
      out.messages.push({ phoneNumberId, from, id, type, text: text.slice(0, 4000), at: new Date(Number(m.timestamp ?? 0) * 1000 || Date.now()), optOut: STOP.test(text), name: v.contacts?.find(x => x.wa_id === from)?.profile?.name ?? null });
    }
    for (const s of v.statuses ?? []) {
      const status = s.status as StatusWhatsApp["status"];
      if (!["sent", "delivered", "read", "failed"].includes(status) || typeof s.id !== "string") continue;
      const err = (s.errors as { title?: string; code?: number }[] | undefined)?.[0];
      out.statuses.push({ phoneNumberId, id: s.id, status, at: new Date(Number(s.timestamp ?? 0) * 1000 || Date.now()), recipient: String(s.recipient_id ?? ""), error: err ? `${err.code ?? ""} ${err.title ?? ""}`.trim() : null });
    }
  }
  return out;
}
