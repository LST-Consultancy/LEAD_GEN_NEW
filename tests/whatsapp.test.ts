import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";

vi.mock("@/lib/providers/http", async (original) => ({ ...(await original<typeof import("@/lib/providers/http")>()), providerJson: vi.fn() }));
import { providerJson } from "@/lib/providers/http";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { allowedKind, messageBody, parseWebhook, validSignature, waNumber } from "@/lib/channels/whatsapp-cloud";
import { connectWhatsApp, handleWhatsAppWebhook, recordWhatsAppOptIn, sendWhatsApp, verifyWhatsAppWebhook } from "@/lib/services/whatsapp";
import { checkOrigin } from "@/lib/security/origin";

const SECRET = "app-secret-synthetic-0123456789";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
const PHONE_ID = String(100000000000000 + Math.floor(Math.random() * 1e9));
const event = (value: Record<string, unknown>) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: PHONE_ID }, ...value } }] }] });

describe("the Cloud API rules", () => {
  it("normalises numbers, allows free text only inside 24 hours, and builds Meta's request bodies", () => {
    expect(waNumber("+91 98200 12345")).toBe("919820012345");
    expect(waNumber("98200 12345")).toBe("919820012345");
    expect(waNumber("123")).toBeNull();
    expect(allowedKind(new Date(Date.now() - 3600_000))).toBe("text_or_template");
    expect(allowedKind(new Date(Date.now() - 25 * 3600_000))).toBe("template_only");
    expect(allowedKind(null)).toBe("template_only");
    expect(messageBody("919820012345", { kind: "template", name: "intro_v1", language: "en", params: ["Meera"] })).toMatchObject({ messaging_product: "whatsapp", type: "template", template: { name: "intro_v1", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Meera" }] }] } });
  });
  it("accepts only a valid signature over the exact body", () => {
    const body = event({});
    expect(validSignature(body, sign(body), SECRET)).toBe(true);
    expect(validSignature(`${body} `, sign(body), SECRET)).toBe(false);
    expect(validSignature(body, "sha256=abc", SECRET)).toBe(false);
    expect(validSignature(body, null, SECRET)).toBe(false);
  });
  it("reads inbound messages, STOP replies and statuses from a delivery", () => {
    const p = parseWebhook(JSON.parse(event({ messages: [{ from: "919820012345", id: "wamid.in1", timestamp: "1758800000", type: "text", text: { body: "STOP" } }], statuses: [{ id: "wamid.out1", status: "read", timestamp: "1758800001", recipient_id: "919820012345" }] })));
    expect(p.messages[0]).toMatchObject({ from: "919820012345", optOut: true });
    expect(p.statuses[0]).toMatchObject({ id: "wamid.out1", status: "read" });
  });
  it("lets only a signed inbound webhook skip the Origin check", () => {
    expect(checkOrigin({ method: "POST", origin: null, referer: null, host: "app.example", hasApiKey: false, signedWebhook: true })).toMatchObject({ ok: true });
    expect(checkOrigin({ method: "POST", origin: null, referer: null, host: "app.example", hasApiKey: false })).toMatchObject({ ok: false, code: "missing_origin" });
  });
});

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });
beforeEach(() => { vi.mocked(providerJson).mockReset(); });

describe("WhatsApp end to end", () => {
  it("connects, refuses cold and out-of-window sends, sends a template, and reads replies, receipts and STOP once", async () => {
    vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32));
    const w = await makeWorkspace("WhatsApp"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const company = await db.company.create({ data: { workspaceId: w.workspace.id, name: "Buyer Synthetic", country: "India" } });
    const person = await db.person.create({ data: { workspaceId: w.workspace.id, fullName: "Meera Synthetic", country: "India" } });
    const lead = await db.lead.create({ data: { workspaceId: w.workspace.id, companyId: company.id, personId: person.id, ownerId: w.user.id, surfacedReason: "fixture" } });
    const sequence = await db.sequence.create({ data: { workspaceId: w.workspace.id, name: "Nurture", stopOnReply: true } });
    const enrollment = await db.sequenceEnrollment.create({ data: { workspaceId: w.workspace.id, sequenceId: sequence.id, leadId: lead.id, state: "active" } });

    vi.mocked(providerJson).mockResolvedValueOnce({ verified_name: "Contoso Synthetic", display_phone_number: "+91 20 5555 0100", quality_rating: "GREEN" } as never);
    expect(await connectWhatsApp(w.ctx, { phoneNumberId: PHONE_ID, businessAccountId: "200000000000001", verifyToken: "verify-token-synthetic", accessToken: "EAAG-synthetic-token-0123456789", appSecret: SECRET })).toMatchObject({ status: "CONNECTED" });
    expect(await verifyWhatsAppWebhook("subscribe", "verify-token-synthetic", "12345")).toBe("12345");
    expect(await verifyWhatsAppWebhook("subscribe", "wrong", "12345")).toBeNull();

    await expect(sendWhatsApp(w.ctx, lead.id, { idempotencyKey: randomUUID(), message: { kind: "template", name: "intro_v1", language: "en", params: [] } })).rejects.toThrow(/opt-in/);
    await recordWhatsAppOptIn(w.ctx, lead.id, { number: "+91 98200 12345", evidence: "Ticked the WhatsApp box on the demo form" });
    await expect(sendWhatsApp(w.ctx, lead.id, { idempotencyKey: randomUUID(), message: { kind: "text", body: "Hi" } })).rejects.toThrow(/24 hours/);
    vi.mocked(providerJson).mockResolvedValueOnce({ messages: [{ id: "wamid.out1" }] } as never);
    const key = randomUUID();
    expect(await sendWhatsApp(w.ctx, lead.id, { idempotencyKey: key, message: { kind: "template", name: "intro_v1", language: "en", params: ["Meera"] } })).toMatchObject({ state: "SENT" });
    expect(await sendWhatsApp(w.ctx, lead.id, { idempotencyKey: key, message: { kind: "template", name: "intro_v1", language: "en", params: ["Meera"] } })).toMatchObject({ note: expect.stringContaining("not sent again") });
    expect(vi.mocked(providerJson).mock.calls.filter(c => String(c[2]).endsWith("/messages"))).toHaveLength(1);

    const receipt = event({ statuses: [{ id: "wamid.out1", status: "read", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "919820012345" }] });
    expect(await handleWhatsAppWebhook(receipt, "sha256=deadbeef")).toMatchObject({ ok: false, status: 401 });
    await handleWhatsAppWebhook(receipt, sign(receipt));
    expect(await db.message.findFirstOrThrow({ where: { workspaceId: w.workspace.id, externalId: "wamid.out1" } })).toMatchObject({ state: "READ" });

    const reply = event({ contacts: [{ wa_id: "919820012345", profile: { name: "Meera" } }], messages: [{ from: "919820012345", id: "wamid.in1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Yes, call me tomorrow" } }] });
    await handleWhatsAppWebhook(reply, sign(reply));
    await handleWhatsAppWebhook(reply, sign(reply)); // Meta retries
    expect(await db.message.count({ where: { workspaceId: w.workspace.id, direction: "INBOUND" } })).toBe(1);
    expect(await db.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).toMatchObject({ state: "replied" });
    // Now inside the 24-hour window, free text is allowed.
    vi.mocked(providerJson).mockResolvedValueOnce({ messages: [{ id: "wamid.out2" }] } as never);
    expect(await sendWhatsApp(w.ctx, lead.id, { idempotencyKey: randomUUID(), message: { kind: "text", body: "Great, 11am?" } })).toMatchObject({ state: "SENT" });

    const stop = event({ messages: [{ from: "919820012345", id: "wamid.in2", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "stop" } }] });
    await handleWhatsAppWebhook(stop, sign(stop));
    expect(await db.suppression.findFirst({ where: { workspaceId: w.workspace.id, kind: "phone", value: "919820012345" } })).not.toBeNull();
    await expect(sendWhatsApp(w.ctx, lead.id, { idempotencyKey: randomUUID(), message: { kind: "text", body: "?" } })).rejects.toThrow();
  });
});
