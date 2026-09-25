import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { providerJson } from "@/lib/providers/http";

/**
 * Razorpay, per its API reference (checked 2026-09-25):
 * - Payment Links: POST https://api.razorpay.com/v1/payment_links (Basic auth key_id:key_secret),
 *   amount in the smallest currency unit, reference_id unique per link; → { id: "plink_…", short_url, status }.
 * - Webhooks: X-Razorpay-Signature is hex HMAC-SHA256 of the raw request body with the webhook
 *   secret; X-Razorpay-Event-Id identifies the event across redeliveries. `payment_link.paid`
 *   carries payload.payment_link.entity { id, amount, amount_paid, currency, reference_id } and
 *   payload.payment.entity { id, amount, currency, status }.
 * Test and live mode are separate key pairs; a key beginning `rzp_test_` never moves real money.
 */
export const razorpayConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
export const razorpayWebhookConfigured = () => Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
export const razorpayTestMode = () => (process.env.RAZORPAY_KEY_ID ?? "").startsWith("rzp_test_");
const auth = () => ({ Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}` });

export async function createPaymentLink(workspaceId: string, input: { referenceId: string; amountPaise: number; currency: string; description: string; customer: { name: string; email: string }; notes: Record<string, string>; callbackUrl: string | null; expireBy: Date }) {
  const body: Record<string, unknown> = {
    amount: input.amountPaise, currency: input.currency, accept_partial: false, reference_id: input.referenceId, description: input.description.slice(0, 2048),
    customer: input.customer, notify: { sms: false, email: false }, reminder_enable: false, notes: input.notes, expire_by: Math.floor(input.expireBy.getTime() / 1000),
    ...(input.callbackUrl ? { callback_url: input.callbackUrl, callback_method: "get" } : {}),
  };
  return z.object({ id: z.string(), short_url: z.string().url(), status: z.string(), reference_id: z.string().nullish() }).passthrough().parse(await providerJson(workspaceId, "razorpay", "https://api.razorpay.com/v1/payment_links", auth(), body));
}

/** Constant-time check of a webhook signature against the raw body. */
export function validWebhookSignature(rawBody: string, signature: string | null, secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "") {
  if (!secret || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature.toLowerCase(), "hex"));
}

export const webhookSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment_link: z.object({ entity: z.object({ id: z.string(), amount: z.number().int(), amount_paid: z.number().int().optional(), currency: z.string(), reference_id: z.string().nullish(), status: z.string() }).passthrough() }).optional(),
    payment: z.object({ entity: z.object({ id: z.string(), amount: z.number().int(), currency: z.string(), status: z.string() }).passthrough() }).optional(),
  }).passthrough(),
}).passthrough();
