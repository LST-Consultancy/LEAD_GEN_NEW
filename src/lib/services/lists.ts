import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate } from "@/lib/services/mutate";
import { leadFilterSchema } from "@/lib/leads/filter";
import { listLeads } from "@/lib/services/leads";

/**
 * §24 / §25 — lists and saved searches.
 *
 * A **static** list is a set of leads someone put there. A **smart** list is a
 * saved filter that re-evaluates every time it is read. They are shown as
 * different things on purpose: a static list of 40 that was right last month
 * and a smart list of 40 that is right now are not the same object, and
 * treating them as one is how a stale list gets worked as if it were live.
 */

export async function listLists(ctx: AuthContext) {
  const lists = await db.list.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: [{ isDynamic: "desc" }, { updatedAt: "desc" }],
    include: {
      _count: { select: { members: true } },
    },
  });

  const visible = leadVisibilityFilter(ctx);

  // Static counts must respect visibility: a rep should not be told a list has
  // 40 leads when they can only work 6 of them.
  const visibleCounts = await Promise.all(
    lists
      .filter((l) => !l.isDynamic)
      .map(async (l) => ({
        id: l.id,
        visible: await db.listMember.count({
          where: { listId: l.id, workspaceId: ctx.workspaceId, lead: { deletedAt: null, ...visible } },
        }),
      }))
  );
  const visibleById = new Map(visibleCounts.map((c) => [c.id, c.visible]));

  // Smart lists are counted by running their filter, which is the only count
  // that means anything for them.
  const dynamicCounts = await Promise.all(
    lists
      .filter((l) => l.isDynamic)
      .map(async (l) => {
        const parsed = leadFilterSchema.safeParse(l.filterJson);
        if (!parsed.success) {
          return { id: l.id, count: null, broken: true as const };
        }
        const result = await listLeads(ctx, { ...parsed.data, pageSize: 10, page: 1 });
        return { id: l.id, count: result.total, broken: false as const };
      })
  );
  const dynamicById = new Map(dynamicCounts.map((c) => [c.id, c]));

  return lists.map((l) => {
    const dynamic = dynamicById.get(l.id);
    return {
      id: l.id,
      name: l.name,
      description: l.description,
      isDynamic: l.isDynamic,
      color: l.color,
      filter: l.filterJson,
      /** What the list holds right now, for whoever is asking. */
      count: l.isDynamic ? (dynamic?.count ?? 0) : (visibleById.get(l.id) ?? 0),
      /** For a static list, how many rows exist regardless of visibility. */
      totalMembers: l.isDynamic ? null : l._count.members,
      /**
       * A smart list whose saved filter no longer parses. It would silently
       * return everything or nothing, so it is marked rather than shown as a
       * working list with a plausible number beside it.
       */
      broken: dynamic?.broken ?? false,
      updatedAt: l.updatedAt.toISOString(),
      createdAt: l.createdAt.toISOString(),
    };
  });
}

const listSchema = z.object({
  name: z.string().trim().min(2, "Give the list a name.").max(80),
  description: z.string().trim().max(400).optional(),
  isDynamic: z.boolean().default(false),
  filter: z.record(z.string(), z.unknown()).default({}),
  color: z.string().trim().max(20).optional(),
});

export type ListInput = z.input<typeof listSchema>;

export async function createList(ctx: AuthContext, raw: ListInput) {
  const input = listSchema.parse(raw);

  if (input.isDynamic) {
    const parsed = leadFilterSchema.safeParse(input.filter);
    if (!parsed.success) {
      throw new MutationError(
        "That filter is not one this app can run, so the list would never show the right leads.",
        "bad_filter",
        422
      );
    }
    // A smart list with no conditions is every lead, which is the Leads screen.
    const meaningful = Object.entries(parsed.data).filter(
      ([k, v]) =>
        !["combine", "sort", "dir", "page", "pageSize"].includes(k) &&
        v !== undefined &&
        !(Array.isArray(v) && v.length === 0)
    );
    if (meaningful.length === 0) {
      throw new MutationError(
        "A smart list with no conditions is just every lead. Add at least one filter, or make it a static list.",
        "empty_filter",
        422
      );
    }
  }

  const clash = await db.list.findFirst({
    where: { workspaceId: ctx.workspaceId, name: input.name, deletedAt: null },
    select: { id: true },
  });
  if (clash) {
    throw new MutationError("A list with that name already exists.", "duplicate_name", 409);
  }

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const list = await db.list.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        description: input.description,
        isDynamic: input.isDynamic,
        filterJson: input.filter as never,
        color: input.color,
        createdById: ctx.userId,
      },
    });

    return {
      result: {
        list: toPlain(list),
        note: input.isDynamic
          ? "Created. It re-runs its filter every time you open it, so it is always current."
          : "Created. Add leads to it from the Leads screen — it holds exactly what you put in it.",
      },
      log: {
        action: "list.created",
        objectType: "List",
        objectId: list.id,
        after: { name: input.name, isDynamic: input.isDynamic },
      },
    };
  });
}

export async function deleteList(ctx: AuthContext, id: string) {
  const list = await loadScoped(
    () => db.list.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }),
    "That list"
  );

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    await db.list.update({ where: { id }, data: { deletedAt: new Date() } });
    return {
      result: {
        note: list.isDynamic
          ? "Removed. It was a saved filter, so no leads were affected."
          : "Removed. The leads it held are untouched — only the grouping is gone.",
      },
      log: {
        action: "list.deleted",
        objectType: "List",
        objectId: id,
        before: { name: list.name, isDynamic: list.isDynamic },
      },
    };
  });
}

/**
 * §25 — saved searches, and whether their alerts can actually fire.
 */
export async function listSavedSearches(ctx: AuthContext) {
  const searches = await db.savedSearch.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: [{ alertEnabled: "desc" }, { updatedAt: "desc" }],
  });

  return Promise.all(
    searches.map(async (s) => {
      const parsed = leadFilterSchema.safeParse(s.filterJson);
      let matches: number | null = null;
      if (parsed.success && s.surface === "leads") {
        const result = await listLeads(ctx, { ...parsed.data, pageSize: 10, page: 1 });
        matches = result.total;
      }

      return {
        id: s.id,
        name: s.name,
        surface: s.surface,
        filter: s.filterJson,
        alertEnabled: s.alertEnabled,
        frequency: s.frequency,
        lastAlertAt: s.lastAlertAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
        /** How many it matches now, when the surface is one we can count. */
        matches,
        /** The filter no longer parses, so the search cannot run. */
        broken: !parsed.success,
        /**
         * Alerts fire when *new* matches appear. With no discovery source,
         * new leads only arrive by import — so an alert can be correctly
         * configured and still never fire, which is worth saying.
         */
        countable: parsed.success && s.surface === "leads",
      };
    })
  );
}

const savedSearchSchema = z.object({
  name: z.string().trim().min(2).max(80),
  surface: z.string().trim().min(1).max(40).default("leads"),
  filter: z.record(z.string(), z.unknown()).default({}),
  alertEnabled: z.boolean().default(false),
  frequency: z.enum(["REALTIME", "DAILY", "WEEKLY"]).default("DAILY"),
});

export type SavedSearchInput = z.input<typeof savedSearchSchema>;

export async function createSavedSearch(ctx: AuthContext, raw: SavedSearchInput) {
  const input = savedSearchSchema.parse(raw);

  if (input.surface === "leads" && !leadFilterSchema.safeParse(input.filter).success) {
    throw new MutationError(
      "That filter is not one this app can run.",
      "bad_filter",
      422
    );
  }

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const saved = await db.savedSearch.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        surface: input.surface,
        filterJson: input.filter as never,
        alertEnabled: input.alertEnabled,
        frequency: input.frequency,
        createdById: ctx.userId,
      },
    });

    return {
      result: {
        savedSearch: toPlain(saved),
        note: input.alertEnabled
          ? "Saved, with alerts on. It notifies you when a new lead matches — which today means when one is imported, since no discovery source is connected."
          : "Saved. Turn on alerts to be told when something new matches.",
      },
      log: {
        action: "saved_search.created",
        objectType: "SavedSearch",
        objectId: saved.id,
        after: { name: input.name, alertEnabled: input.alertEnabled },
      },
    };
  });
}

export async function setSavedSearchAlert(ctx: AuthContext, id: string, alertEnabled: boolean) {
  const saved = await loadScoped(
    () => db.savedSearch.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }),
    "That saved search"
  );

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const updated = await db.savedSearch.update({
      where: { id },
      data: { alertEnabled },
    });
    return {
      result: {
        savedSearch: toPlain(updated),
        note: alertEnabled
          ? "Alerts on. You will be told when a new lead matches this search."
          : "Alerts off. The search is kept; it just will not notify you.",
      },
      log: {
        action: alertEnabled ? "saved_search.alert_on" : "saved_search.alert_off",
        objectType: "SavedSearch",
        objectId: id,
        before: { alertEnabled: saved.alertEnabled },
        after: { alertEnabled },
      },
    };
  });
}

export async function deleteSavedSearch(ctx: AuthContext, id: string) {
  const saved = await loadScoped(
    () => db.savedSearch.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }),
    "That saved search"
  );

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    await db.savedSearch.update({ where: { id }, data: { deletedAt: new Date() } });
    return {
      result: { note: "Removed. No leads were affected — it was only a stored query." },
      log: {
        action: "saved_search.deleted",
        objectType: "SavedSearch",
        objectId: id,
        before: { name: saved.name },
      },
    };
  });
}
