import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { mutate, MutationError } from "./mutate";
import { recordExternalAudit } from "./audit";
import { toPaise } from "@/lib/proposals/money";
import { createPaymentLink, razorpayConfigured, razorpayTestMode, razorpayWebhookConfigured, validWebhookSignature, webhookSchema } from "@/lib/billing/razorpay";

/**
 * Paying for a plan. Prices come from the Plan rows, never from here; no tax is added or
 * computed — the amount charged is the plan's listed price, and the screen says so. The
 * subscription changes only when the provider's signed webhook reports exactly that amount paid,
 * and each provider event is processed once however often it is delivered.
 */
export function billingProviderStatus() {
  return { provider: "razorpay" as const, configured: razorpayConfigured(), webhookConfigured: razorpayWebhookConfigured(), testMode: razorpayTestMode() };
}

export async function listCheckouts(ctx: AuthContext) {
  const rows = await db.billingCheckout.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, provider: true, period: true, amountPaise: true, currency: true, status: true, testMode: true, url: true, paymentRef: true, note: true, createdAt: true, paidAt: true, planId: true } });
  const plans = await db.plan.findMany({ where: { id: { in: rows.map(r => r.planId) } }, select: { id: true, name: true } });
  return toPlain(rows.map(r => ({ ...r, planName: plans.find(p => p.id === r.planId)?.name ?? "Plan" })));
}

const checkoutSchema = z.object({ planKey: z.string().min(1).max(60), period: z.enum(["monthly", "yearly"]).default("monthly") });

/** Creates (or reuses) a payment link for a plan at its listed price. Nothing is charged until the person pays on Razorpay. */
export async function startCheckout(ctx: AuthContext, raw: unknown) {
  const input = checkoutSchema.parse(raw ?? {});
  if (!razorpayConfigured()) throw new MutationError("Payments are not set up on this server: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are needed (test keys begin rzp_test_). Nothing was charged.", "not_configured", 422);
  if (!razorpayWebhookConfigured()) throw new MutationError("Payments need RAZORPAY_WEBHOOK_SECRET too — without the webhook a payment could not change the plan, so no link was created.", "not_configured", 422);
  const plan = await db.plan.findFirst({ where: { key: input.planKey, isPublic: true } });
  if (!plan) throw new MutationError("That plan is not offered.", "not_found", 404);
  const price = input.period === "yearly" ? plan.priceYearly : plan.priceMonthly;
  if (price === null || Number(price) <= 0) throw new MutationError(input.period === "yearly" ? "This plan has no yearly price." : "This plan has no price to pay.", "no_price", 422);
  const amountPaise = toPaise(Number(price));
  const recent = await db.billingCheckout.findFirst({ where: { workspaceId: ctx.workspaceId, planId: plan.id, period: input.period, status: "CREATED", amountPaise, createdAt: { gte: new Date(Date.now() - 30 * 60_000) } }, orderBy: { createdAt: "desc" } });
  if (recent?.url) return { checkout: toPlain(recent), reused: true };
  return mutate(ctx, PERMISSIONS.BILLING_MANAGE, async () => {
    const id = crypto.randomUUID();
    const base = process.env.APP_URL?.replace(/\/+$/, "");
    const link = await createPaymentLink(ctx.workspaceId, { referenceId: id, amountPaise, currency: plan.currency, description: `${plan.name} plan — ${input.period === "yearly" ? "12 months" : "1 month"} for ${ctx.workspace.name}`, customer: { name: ctx.user.name, email: ctx.user.email }, notes: { workspaceId: ctx.workspaceId, planKey: plan.key, period: input.period }, callbackUrl: base ? `${base}/settings/billing?payment=returned` : null, expireBy: new Date(Date.now() + 24 * 3600_000) });
    const row = await db.billingCheckout.create({ data: { id, workspaceId: ctx.workspaceId, provider: "razorpay", providerRef: link.id, planId: plan.id, period: input.period, amountPaise, currency: plan.currency, testMode: razorpayTestMode(), url: link.short_url, createdById: ctx.userId } });
    return { result: { checkout: toPlain(row), reused: false }, log: { action: "billing.checkout_created", objectType: "BillingCheckout", objectId: row.id, after: { plan: plan.key, period: input.period, amountPaise, currency: plan.currency, testMode: row.testMode } } };
  });
}

const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };

/**
 * A Razorpay webhook. Verified by signature over the raw body before anything is parsed, and
 * recorded by event id first, so a redelivery returns `duplicate` and changes nothing.
 */
export async function handleRazorpayWebhook(rawBody: string, signature: string | null, eventIdHeader: string | null): Promise<{ status: number; outcome: string }> {
  if (!validWebhookSignature(rawBody, signature)) return { status: 401, outcome: "bad_signature" };
  let parsed: z.infer<typeof webhookSchema>;
  try { parsed = webhookSchema.parse(JSON.parse(rawBody)); } catch { return { status: 400, outcome: "malformed" }; }
  const link = parsed.payload.payment_link?.entity; const payment = parsed.payload.payment?.entity;
  const eventId = eventIdHeader ?? `${parsed.event}:${link?.id ?? ""}:${payment?.id ?? ""}`;
  const checkout = link ? await db.billingCheckout.findFirst({ where: { provider: "razorpay", providerRef: link.id } }) : null;
  try {
    await db.billingEvent.create({ data: { provider: "razorpay", eventId, type: parsed.event, workspaceId: checkout?.workspaceId ?? null, checkoutId: checkout?.id ?? null, outcome: "received", detail: { linkId: link?.id ?? null, paymentId: payment?.id ?? null, amountPaid: link?.amount_paid ?? payment?.amount ?? null, currency: link?.currency ?? payment?.currency ?? null } } });
  } catch { return { status: 200, outcome: "duplicate" }; }
  const done = async (outcome: string) => { await db.billingEvent.update({ where: { provider_eventId: { provider: "razorpay", eventId } }, data: { outcome } }); return { status: 200, outcome }; };
  if (!checkout || !link) return done(link ? "unknown_link" : "ignored");
  if (link.reference_id && link.reference_id !== checkout.id) return done("reference_mismatch");
  if (parsed.event === "payment_link.expired" || parsed.event === "payment_link.cancelled") {
    if (checkout.status === "CREATED") await db.billingCheckout.update({ where: { id: checkout.id }, data: { status: parsed.event.endsWith("expired") ? "EXPIRED" : "CANCELLED" } });
    return done("closed");
  }
  if (parsed.event !== "payment_link.paid") return done("ignored");
  if (checkout.status === "PAID") return done("already_paid");
  const paid = link.amount_paid ?? payment?.amount ?? 0;
  if (paid !== checkout.amountPaise || link.currency !== checkout.currency) {
    // Reported, never silently fixed: a person decides what a different amount means.
    await db.billingCheckout.update({ where: { id: checkout.id }, data: { status: "MISMATCH", paymentRef: payment?.id ?? null, note: `Razorpay reported ${paid} ${link.currency} (smallest unit) paid against ${checkout.amountPaise} ${checkout.currency} asked. The plan was not changed; check the payment in Razorpay.` } });
    await recordExternalAudit(checkout.workspaceId, { action: "billing.payment_mismatch", objectType: "BillingCheckout", objectId: checkout.id, after: { paid, asked: checkout.amountPaise }, claimedBy: "Razorpay", via: "signed webhook" });
    return done("mismatch");
  }
  await db.$transaction(async tx => {
    const current = await tx.subscription.findUnique({ where: { workspaceId: checkout.workspaceId } });
    const now = new Date();
    // Paying again before the period ends extends it rather than losing the days left.
    const from = current && current.status === "active" && current.planId === checkout.planId && current.currentPeriodEnd > now ? current.currentPeriodEnd : now;
    const end = addMonths(from, checkout.period === "yearly" ? 12 : 1);
    await tx.subscription.upsert({ where: { workspaceId: checkout.workspaceId }, create: { workspaceId: checkout.workspaceId, planId: checkout.planId, status: "active", currentPeriodStart: from, currentPeriodEnd: end }, update: { planId: checkout.planId, status: "active", currentPeriodStart: from, currentPeriodEnd: end, cancelledAt: null, trialEndsAt: null } });
    await tx.billingCheckout.update({ where: { id: checkout.id }, data: { status: "PAID", paidAt: now, paymentRef: payment?.id ?? null } });
  });
  await recordExternalAudit(checkout.workspaceId, { action: "billing.payment_received", objectType: "BillingCheckout", objectId: checkout.id, after: { amountPaise: paid, currency: link.currency, testMode: checkout.testMode, paymentRef: payment?.id ?? null }, claimedBy: "Razorpay", via: "signed webhook" });
  return done("activated");
}
