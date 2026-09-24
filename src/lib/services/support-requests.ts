import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { MutationError } from "./mutate";
import { recordAudit } from "./audit";
import { getSupportDiagnostics } from "./support";

/**
 * Support requests. They go to this workspace's administrators — the people
 * who can actually change its settings — not to an outside vendor desk, and
 * the screen says so. Anyone signed in can raise one and see their own;
 * people who manage users see and answer all of them.
 */

const STATUSES = ["open", "answered", "closed"] as const;
type Entry = { at: string; by: string; status: (typeof STATUSES)[number]; note: string | null };

const createSchema = z.object({
  subject: z.string().trim().min(4, "Say in a few words what it is about.").max(160),
  message: z.string().trim().min(10, "Describe what you expected and what happened.").max(5000),
});

/** SR-7F3K9Q: short, quotable, unguessable enough that it reveals nothing. */
const newReference = () => `SR-${randomBytes(4).toString("base64url").replace(/[-_]/g, "X").slice(0, 6).toUpperCase()}`;
const isAdmin = (ctx: AuthContext) => ctx.permissions.includes(PERMISSIONS.USERS_MANAGE);

export async function createSupportRequest(ctx: AuthContext, raw: z.input<typeof createSchema>) {
  const input = createSchema.parse(raw);
  const { checks } = await getSupportDiagnostics(ctx);
  const entry: Entry = { at: new Date().toISOString(), by: ctx.user.name, status: "open", note: null };
  const row = await db.supportRequest.create({
    data: { workspaceId: ctx.workspaceId, reference: newReference(), createdById: ctx.userId, subject: input.subject, message: input.message, history: [entry], diagnostics: { checks } as never },
  });
  await recordAudit(ctx, { action: "support.requested", objectType: "SupportRequest", objectId: row.id, after: { reference: row.reference, subject: row.subject } });
  return { id: row.id, reference: row.reference };
}

export async function listSupportRequests(ctx: AuthContext) {
  const rows = await db.supportRequest.findMany({
    where: { workspaceId: ctx.workspaceId, ...(isAdmin(ctx) ? {} : { createdById: ctx.userId }) },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 100,
  });
  const authors = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  return rows.map((r) => ({
    id: r.id, reference: r.reference, subject: r.subject, message: r.message, status: r.status,
    history: r.history as Entry[], createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    author: authors.find((a) => a.id === r.createdById)?.name ?? "Former member", mine: r.createdById === ctx.userId,
  }));
}

const updateSchema = z.object({ status: z.enum(STATUSES), note: z.string().trim().max(2000).optional() });

/** An administrator answers or closes; the requester may close their own or reopen it with a note. */
export async function updateSupportRequest(ctx: AuthContext, id: string, raw: z.input<typeof updateSchema>) {
  const input = updateSchema.parse(raw);
  const row = await db.supportRequest.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!row || (!isAdmin(ctx) && row.createdById !== ctx.userId)) throw new MutationError("That request doesn't exist.", "not_found", 404);
  if (!isAdmin(ctx) && input.status === "answered") throw new MutationError("Only an administrator can answer a request.", "forbidden", 403);
  if (input.status === "answered" && !input.note) throw new MutationError("Write the answer before marking it answered.", "note_required", 422);
  const entry: Entry = { at: new Date().toISOString(), by: ctx.user.name, status: input.status, note: input.note ?? null };
  const updated = await db.supportRequest.update({ where: { id }, data: { status: input.status, history: [...(row.history as Entry[]), entry] } });
  await recordAudit(ctx, { action: "support.updated", objectType: "SupportRequest", objectId: id, before: { status: row.status }, after: { status: updated.status } });
  return { id, status: updated.status };
}
