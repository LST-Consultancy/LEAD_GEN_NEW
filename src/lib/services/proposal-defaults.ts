import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { mutate } from "./mutate";

/**
 * Workspace proposal defaults.
 *
 * New proposals start from these; nothing already created reads them again,
 * so an issued proposal's price and terms never move when the defaults do.
 * A package's `priceInr` is structured money and is what becomes a line item —
 * there is no free-text price that could disagree with it.
 */

export const LOGO_MAX_BYTES = 256 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Bytes a base64 data URL decodes to, without decoding it. */
function dataUrlBytes(url: string): number {
  const b64 = url.slice(url.indexOf(",") + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
}

const logoSchema = z
  .string()
  .max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 100, "The logo must be 256 KB or smaller.")
  .refine((v) => new RegExp(`^data:(${LOGO_TYPES.join("|").replace(/\//g, "\\/")});base64,[A-Za-z0-9+/]+=*$`).test(v), "Use a PNG, JPEG or WebP image. SVG isn't accepted because it can carry script.")
  .refine((v) => dataUrlBytes(v) <= LOGO_MAX_BYTES, "The logo must be 256 KB or smaller.");

const packageSchema = z.object({
  name: z.string().trim().min(1, "Every package needs a name.").max(120),
  unit: z.string().trim().min(1).max(30).default("package"),
  priceInr: z.number().finite().min(0).max(1_000_000_000),
  inclusions: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
});

const optionalText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();

export const defaultsSchema = z.object({
  taxRate: z.number().min(0).max(50),
  validityDays: z.number().int().min(1).max(365),
  terms: optionalText(10_000),
  pricingNote: optionalText(2_000),
  description: optionalText(2_000),
  contactEmail: z.string().trim().email("That contact email isn't valid.").or(z.literal("")).transform((v) => v || null).nullable().optional(),
  contactPhone: optionalText(40),
  website: z.string().trim().url("Use a full website address, starting https://").or(z.literal("")).transform((v) => v || null).nullable().optional(),
  address: optionalText(500),
  logoDataUrl: logoSchema.or(z.literal("")).transform((v) => v || null).nullable().optional(),
  packages: z.array(packageSchema).max(30).default([]),
  caseStudies: z.array(z.object({ title: z.string().trim().min(1).max(160), summary: z.string().trim().max(2_000) })).max(20).default([]),
});

export type ProposalDefaultsInput = z.input<typeof defaultsSchema>;
export type ProposalPackage = z.infer<typeof packageSchema>;

const EMPTY = { taxRate: 18, validityDays: 30, terms: null, pricingNote: null, description: null, contactEmail: null, contactPhone: null, website: null, address: null, logoDataUrl: null, packages: [] as ProposalPackage[], caseStudies: [] as { title: string; summary: string }[] };

export async function getProposalDefaults(ctx: AuthContext) {
  const row = await db.proposalDefaults.findUnique({ where: { workspaceId: ctx.workspaceId } });
  if (!row) return { ...EMPTY, saved: false as const, updatedAt: null };
  return {
    taxRate: Number(row.taxRate), validityDays: row.validityDays, terms: row.terms, pricingNote: row.pricingNote,
    description: row.description, contactEmail: row.contactEmail, contactPhone: row.contactPhone, website: row.website,
    address: row.address, logoDataUrl: row.logoDataUrl,
    packages: (row.packages as ProposalPackage[]) ?? [], caseStudies: (row.caseStudies as { title: string; summary: string }[]) ?? [],
    saved: true as const, updatedAt: row.updatedAt.toISOString(),
  };
}

/** Configuring commercial defaults for everyone is a pipeline-configuration power. */
export async function saveProposalDefaults(ctx: AuthContext, raw: ProposalDefaultsInput) {
  const input = defaultsSchema.parse(raw);
  const before = await db.proposalDefaults.findUnique({ where: { workspaceId: ctx.workspaceId } });
  return mutate(ctx, PERMISSIONS.PIPELINE_CONFIGURE, async () => {
    const data = { ...input, updatedById: ctx.userId };
    const row = await db.proposalDefaults.upsert({ where: { workspaceId: ctx.workspaceId }, create: { workspaceId: ctx.workspaceId, ...data }, update: data });
    const summary = (r: { taxRate: unknown; validityDays: number; packages: unknown; logoDataUrl: string | null } | null) =>
      r ? { taxRate: Number(r.taxRate), validityDays: r.validityDays, packages: (r.packages as unknown[]).length, hasLogo: Boolean(r.logoDataUrl) } : null;
    return {
      result: { saved: true, updatedAt: row.updatedAt.toISOString() },
      // The logo itself is kept out of the audit row; only whether one exists.
      log: { action: "proposal_defaults.updated", objectType: "ProposalDefaults", objectId: row.id, before: summary(before), after: summary(row) },
    };
  });
}
