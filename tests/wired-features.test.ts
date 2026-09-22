import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { allRoutedFeatures, modelPlan } from "@/lib/ai/complete";

/**
 * The settings screen tells the user which AI features are actually wired to a
 * model. That claim is only as good as `WIRED_FEATURES`, which is a hand-kept
 * list — so this reads the source and checks each name against a real
 * `complete()` call site. Without it the list rots into a marketing claim.
 */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "generated" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

const CALL_SITES = sourceFiles("src")
  .filter((f) => !f.endsWith("src/lib/ai/complete.ts"))
  .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/feature:\s*"([a-z_]+)"/g)].map((m) => m[1]));

describe("wired AI features", () => {
  it("lists only features with a real complete() call site", () => {
    const unreachable = modelPlan()
      .map((p) => p.feature)
      .filter((feature) => !CALL_SITES.includes(feature));

    expect(unreachable, "listed as wired but nothing passes this feature to complete()").toEqual([]);
  });

  it("does not mark a feature wired that the routing table doesn't know", () => {
    const routed = new Set(allRoutedFeatures().map((f) => f.feature));
    for (const { feature } of modelPlan()) expect(routed.has(feature)).toBe(true);
  });

  it("routes every known feature to a model name", () => {
    for (const f of allRoutedFeatures()) expect(f.model).toBeTruthy();
  });
});
