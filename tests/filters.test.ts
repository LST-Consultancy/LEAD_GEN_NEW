import { describe, expect, it } from "vitest";
import { buildLeadQuery, parseLeadParams, countActiveFilters } from "@/lib/leads/params";
import { SHORTCUTS, leadFilterSchema } from "@/lib/leads/filter";

/** Turns a query string back into the params shape a Next.js page receives. */
function toParams(query: string): Record<string, string | string[] | undefined> {
  const sp = new URLSearchParams(query.replace(/^\?/, ""));
  return Object.fromEntries(sp.entries());
}

describe("lead filter params — the URL is the source of truth", () => {
  it("round-trips a rich filter without losing anything", () => {
    const original = leadFilterSchema.parse({
      q: "salesforce",
      tiers: ["A", "B"],
      statuses: ["NEW", "REPLIED"],
      intents: ["HOT", "BUYING"],
      minScore: 7,
      maxScore: 10,
      industries: ["Manufacturing", "Logistics"],
      cities: ["Pune"],
      decisionMakersOnly: true,
      reachable: true,
      surfacedWithinDays: 14,
      combine: "OR",
      sort: "value",
      dir: "asc",
      page: 3,
    });

    const { filter } = parseLeadParams(toParams(buildLeadQuery(original)));

    expect(filter.q).toBe("salesforce");
    expect(filter.tiers).toEqual(["A", "B"]);
    expect(filter.statuses).toEqual(["NEW", "REPLIED"]);
    expect(filter.intents).toEqual(["HOT", "BUYING"]);
    expect(filter.minScore).toBe(7);
    expect(filter.maxScore).toBe(10);
    expect(filter.industries).toEqual(["Manufacturing", "Logistics"]);
    expect(filter.cities).toEqual(["Pune"]);
    expect(filter.decisionMakersOnly).toBe(true);
    expect(filter.reachable).toBe(true);
    expect(filter.surfacedWithinDays).toBe(14);
    expect(filter.combine).toBe("OR");
    expect(filter.sort).toBe("value");
    expect(filter.dir).toBe("asc");
    expect(filter.page).toBe(3);
  });

  it("omits defaults from the URL so shared links stay readable", () => {
    const query = buildLeadQuery(leadFilterSchema.parse({}));
    expect(query).toBe("");
  });

  it("omits page 1 and the default page size", () => {
    const query = buildLeadQuery(leadFilterSchema.parse({ page: 1, pageSize: 50, tiers: ["A"] }));
    expect(query).toBe("?tiers=A");
  });

  it("falls back to defaults for unknown or malformed values", () => {
    // A hand-edited or stale URL must not take the page down.
    const { filter } = parseLeadParams({ sort: "nonsense", dir: "sideways", page: "abc" });
    expect(filter.sort).toBe("score");
    expect(filter.dir).toBe("desc");
    expect(filter.page).toBe(1);
  });

  it("keeps the valid filters when only one value is malformed", () => {
    const { filter } = parseLeadParams({
      tiers: "A,B",
      sort: "garbage",
      minScore: "8",
    });
    // The bad sort is dropped; the good filters survive.
    expect(filter.sort).toBe("score");
    expect(filter.tiers).toEqual(["A", "B"]);
    expect(filter.minScore).toBe(8);
  });

  it("survives an out-of-range numeric param in the URL", () => {
    const { filter } = parseLeadParams({ minScore: "999", tiers: "A" });
    expect(filter.minScore).toBeUndefined();
    expect(filter.tiers).toEqual(["A"]);
  });

  it("survives an unknown enum member inside an array param", () => {
    const { filter } = parseLeadParams({ tiers: "A,Z", intents: "HOT" });
    expect(filter.tiers).toBeUndefined();
    expect(filter.intents).toEqual(["HOT"]);
  });

  it("rejects an out-of-range score rather than silently clamping", () => {
    expect(() => leadFilterSchema.parse({ minScore: 50 })).toThrow();
    expect(() => leadFilterSchema.parse({ minScore: -1 })).toThrow();
  });

  it("caps the page size so a caller cannot ask for everything", () => {
    expect(() => leadFilterSchema.parse({ pageSize: 5000 })).toThrow();
    expect(leadFilterSchema.parse({ pageSize: 200 }).pageSize).toBe(200);
  });

  it("lets an explicit param override the shortcut it was combined with", () => {
    // "score-8-plus" presets minScore 8; an explicit 9 in the URL must win.
    const { filter, shortcut } = parseLeadParams({ shortcut: "score-8-plus", minScore: "9" });
    expect(shortcut).toBe("score-8-plus");
    expect(filter.minScore).toBe(9);
  });

  it("applies a shortcut's preset when nothing overrides it", () => {
    const { filter } = parseLeadParams({ shortcut: "richest-vein" });
    expect(filter.tiers).toEqual(["A", "B"]);
    expect(filter.surfacedWithinDays).toBe(14);
    expect(filter.reachable).toBe(true);
  });

  it("ignores an unknown shortcut instead of throwing", () => {
    const { filter, shortcut } = parseLeadParams({ shortcut: "does-not-exist" });
    expect(shortcut).toBeNull();
    expect(filter.tiers).toBeUndefined();
  });

  it("every shortcut parses into a valid filter", () => {
    for (const s of SHORTCUTS) {
      expect(() => leadFilterSchema.parse(s.filter), s.key).not.toThrow();
      const { filter } = parseLeadParams({ shortcut: s.key });
      expect(filter, s.key).toBeDefined();
    }
  });

  it("counts only user-meaningful filters", () => {
    expect(countActiveFilters(leadFilterSchema.parse({}))).toBe(0);
    // Paging and sorting are not filters.
    expect(countActiveFilters(leadFilterSchema.parse({ page: 4, sort: "value" }))).toBe(0);
    expect(
      countActiveFilters(leadFilterSchema.parse({ tiers: ["A"], q: "acme", replied: true }))
    ).toBe(3);
  });

  it("drops an empty array rather than emitting a dangling param", () => {
    expect(buildLeadQuery({ tiers: [], industries: [] })).toBe("");
  });

  it("treats a falsy boolean as absent", () => {
    expect(buildLeadQuery({ starred: false, replied: false })).toBe("");
    expect(buildLeadQuery({ starred: true })).toBe("?starred=1");
  });
});
