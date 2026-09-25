/**
 * Paying for a plan through Razorpay Payment Links: the amount comes from the Plan row, the plan
 * changes only on a signed webhook for exactly that amount, and every event is processed once.
 * The Razorpay API is replaced by a fake; webhooks are signed here with a test secret.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
vi.mock("@/lib/providers/http", async original => ({ ...(await original<typeof import("@/lib/providers/http")>()), providerJson: vi.fn() }));
import { providerJson } from "@/lib/providers/http";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { handleRazorpayWebhook, startCheckout } from "@/lib/services/billing";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
// Provider event ids are global, so each run uses fresh ones and removes them afterwards.
const RUN = randomUUID().slice(0, 8);
const ev = (name: string) => `evt_${RUN}_${name}`;
afterAll(async () => { await db.billingEvent.deleteMany({ where: { eventId: { startsWith: `evt_${RUN}_` } } }); await cleanup(created); await db.$disconnect(); });
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_synthetic"); vi.stubEnv("RAZORPAY_KEY_SECRET", "secret-synthetic"); vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec-synthetic");
  vi.mocked(providerJson).mockReset().mockImplementation((async (_w: string, _p: string, _u: string, _h: unknown, body: { reference_id: string }) => ({ id: `plink_${randomUUID().slice(0, 8)}`, short_url: "https://rzp.io/i/synthetic", status: "created", reference_id: body.reference_id })) as never);
});
const sign = (raw: string, secret = "whsec-synthetic") => createHmac("sha256", secret).update(raw).digest("hex");
function paidEvent(linkId: string, reference: string, amountPaid: number, currency = "INR") {
  return JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: linkId, amount: amountPaid, amount_paid: amountPaid, currency, reference_id: reference, status: "paid" } }, payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}`, amount: amountPaid, currency, status: "captured" } } } });
}
async function setup() {
  const w = await makeWorkspace("Billing"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  const plan = await db.plan.create({ data: { key: `paid-${randomUUID().slice(0, 8)}`, name: "Growth (test)", priceMonthly: 4999.5, priceYearly: 49995, currency: "INR", isPublic: false } });
  created.planIds.push(plan.id);
  await db.plan.update({ where: { id: plan.id }, data: { isPublic: true } });
  return { w, plan };
}

describe("Razorpay checkout", () => {
  it("charges the plan's listed price in paise, reuses an open link, and refuses without webhook set up", async () => {
    const { w, plan } = await setup();
    try {
      const a = await startCheckout(w.ctx, { planKey: plan.key });
      expect(a).toMatchObject({ reused: false, checkout: { amountPaise: 499950, currency: "INR", testMode: true, status: "CREATED" } });
      const body = vi.mocked(providerJson).mock.calls[0][4] as Record<string, unknown>;
      expect(body).toMatchObject({ amount: 499950, currency: "INR", accept_partial: false, reference_id: a.checkout.id });
      expect(vi.mocked(providerJson).mock.calls[0][3]).toMatchObject({ Authorization: expect.stringMatching(/^Basic /) });
      expect(await startCheckout(w.ctx, { planKey: plan.key })).toMatchObject({ reused: true });
      expect(providerJson).toHaveBeenCalledTimes(1);
      vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
      await expect(startCheckout(w.ctx, { planKey: plan.key, period: "yearly" })).rejects.toThrow(/RAZORPAY_WEBHOOK_SECRET/);
    } finally { await db.plan.update({ where: { id: plan.id }, data: { isPublic: false } }); }
  });

  it("activates the plan only on a signed webhook for exactly the amount asked, and processes each event once", async () => {
    const { w, plan } = await setup();
    try {
      const { checkout } = await startCheckout(w.ctx, { planKey: plan.key });
      const row = await db.billingCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
      const raw = paidEvent(row.providerRef, row.id, 499950);
      expect(await handleRazorpayWebhook(raw, sign(raw, "wrong-secret"), ev("1"))).toMatchObject({ status: 401 });
      expect(await handleRazorpayWebhook(raw.replace("499950", "1"), sign(raw), ev("1"))).toMatchObject({ status: 401 });
      expect((await db.subscription.findUniqueOrThrow({ where: { workspaceId: w.workspace.id } })).planId).not.toBe(plan.id);
      expect(await handleRazorpayWebhook(raw, sign(raw), ev("1"))).toMatchObject({ status: 200, outcome: "activated" });
      const sub = await db.subscription.findUniqueOrThrow({ where: { workspaceId: w.workspace.id } });
      expect(sub).toMatchObject({ planId: plan.id, status: "active" });
      const end = sub.currentPeriodEnd;
      // Redelivered: recognised by event id and changes nothing.
      expect(await handleRazorpayWebhook(raw, sign(raw), ev("1"))).toMatchObject({ outcome: "duplicate" });
      expect((await db.subscription.findUniqueOrThrow({ where: { workspaceId: w.workspace.id } })).currentPeriodEnd).toEqual(end);
      expect(await db.billingCheckout.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "PAID", paymentRef: expect.stringMatching(/^pay_/) });
      expect(await db.auditLog.count({ where: { workspaceId: w.workspace.id, action: "billing.payment_received" } })).toBe(1);
    } finally { await db.plan.update({ where: { id: plan.id }, data: { isPublic: false } }); }
  });

  it("records a different amount as a mismatch and does not change the plan", async () => {
    const { w, plan } = await setup();
    try {
      const { checkout } = await startCheckout(w.ctx, { planKey: plan.key });
      const row = await db.billingCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
      const raw = paidEvent(row.providerRef, row.id, 100);
      expect(await handleRazorpayWebhook(raw, sign(raw), ev("m"))).toMatchObject({ outcome: "mismatch" });
      expect(await db.billingCheckout.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "MISMATCH", note: expect.stringContaining("not changed") });
      expect((await db.subscription.findUniqueOrThrow({ where: { workspaceId: w.workspace.id } })).planId).not.toBe(plan.id);
      // A link id this app never created is ignored.
      const stray = paidEvent("plink_unknown", randomUUID(), 499950);
      expect(await handleRazorpayWebhook(stray, sign(stray), ev("s"))).toMatchObject({ outcome: "unknown_link" });
    } finally { await db.plan.update({ where: { id: plan.id }, data: { isPublic: false } }); }
  });
});
