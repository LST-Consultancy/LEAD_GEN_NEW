import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, cleanup } from "./helpers/fixtures";
import {
  byTouch,
  byWeekday,
  generateCoachTip,
  MIN_GAP_POINTS,
  MIN_SAMPLE_PER_GROUP,
  parseCoachTip,
  rate,
} from "@/lib/ai/coach";

/**
 * The Today screen's sales coach panel has read from `AIInsight` since it
 * shipped, but nothing ever wrote a `COACH_TIP` row — the panel always showed
 * its empty state. `generateCoachTip` is what writes it, and the comparison it
 * picks has to be a real one: computed here in code from actual sends and
 * replies, never left to the model to compute or invent.
 */

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("rate", () => {
  it("rounds a reply rate to a whole percentage", () => {
    expect(rate(1, 3)).toBe(33);
    expect(rate(0, 10)).toBe(0);
    expect(rate(10, 10)).toBe(100);
  });
});

describe("byWeekday", () => {
  const monday = (n: number) => new Date(`2026-02-0${2 + n}T10:00:00Z`); // Mon..Fri, Asia/Kolkata

  function sendsOn(day: Date, total: number, replied: number) {
    return Array.from({ length: total }, (_, i) => ({ sentAt: day, gotReply: i < replied }));
  }

  it("returns null when fewer than two weekdays clear the sample floor", () => {
    const sends = sendsOn(monday(0), MIN_SAMPLE_PER_GROUP, MIN_SAMPLE_PER_GROUP);
    expect(byWeekday(sends)).toBeNull();
  });

  it("returns null when the best and worst weekday are too close to matter", () => {
    // Both at 50% — no gap at all.
    const sends = [
      ...sendsOn(monday(0), 10, 5),
      ...sendsOn(monday(1), 10, 5),
    ];
    expect(byWeekday(sends)).toBeNull();
  });

  it("surfaces the best-vs-worst weekday once the gap clears the floor, with the real counts", () => {
    const sends = [
      ...sendsOn(monday(0), 10, 8), // Monday: 80%
      ...sendsOn(monday(1), 10, 1), // Tuesday: 10%
    ];
    const found = byWeekday(sends);
    expect(found).not.toBeNull();
    expect(found!.best.label).toBe("Monday");
    expect(found!.best.replied).toBe(8);
    expect(found!.best.total).toBe(10);
    expect(found!.worst.label).toBe("Tuesday");
    expect(found!.worst.replied).toBe(1);
    expect(found!.gapPoints).toBe(70);
    expect(found!.gapPoints).toBeGreaterThanOrEqual(MIN_GAP_POINTS);
    // Every number in the sentence the model will see traces to a real count.
    expect(found!.factLine).toContain("80% replied (8 of 10)");
    expect(found!.factLine).toContain("10% replied (1 of 10)");
    expect(found!.allowedNumbers).toEqual(expect.arrayContaining([80, 10, 8, 1, 70]));
  });
});

describe("byTouch", () => {
  function touches(stepOrder: number, total: number, replied: number) {
    return Array.from({ length: total }, (_, i) => ({ stepOrder, gotReply: i < replied }));
  }

  it("returns null below the sample floor on either side", () => {
    const sends = [...touches(1, MIN_SAMPLE_PER_GROUP - 1, 5), ...touches(2, 10, 1)];
    expect(byTouch(sends)).toBeNull();
  });

  it("returns null when first touch and follow-up perform about the same", () => {
    const sends = [...touches(1, 10, 5), ...touches(3, 10, 4)];
    expect(byTouch(sends)).toBeNull();
  });

  it("labels a stronger first touch correctly, without inventing a number", () => {
    const sends = [...touches(1, 10, 8), ...touches(2, 10, 1)];
    const found = byTouch(sends);
    expect(found).not.toBeNull();
    expect(found!.best.label).toBe("First touch");
    expect(found!.worst.label).toBe("Follow-up");
    expect(found!.gapPoints).toBe(70);
  });

  it("labels a stronger follow-up correctly when that's what the data shows", () => {
    // Treats every step after the first as one "follow-up" bucket.
    const sends = [...touches(1, 10, 1), ...touches(2, 5, 4), ...touches(3, 5, 4)];
    const found = byTouch(sends);
    expect(found).not.toBeNull();
    expect(found!.best.label).toBe("Follow-up");
    expect(found!.best.total).toBe(10);
    expect(found!.worst.label).toBe("First touch");
  });
});

describe("parseCoachTip", () => {
  it("parses a plain JSON object", () => {
    expect(parseCoachTip('{"title": "A", "body": "B", "whyNow": "C"}')).toEqual({
      title: "A",
      body: "B",
      whyNow: "C",
    });
  });

  it("tolerates a fenced code block", () => {
    expect(parseCoachTip('```json\n{"title": "A", "body": "B", "whyNow": "C"}\n```')).toEqual({
      title: "A",
      body: "B",
      whyNow: "C",
    });
  });

  it("allows whyNow to be absent", () => {
    expect(parseCoachTip('{"title": "A", "body": "B"}')).toEqual({ title: "A", body: "B", whyNow: "" });
  });

  it("rejects a reply with no title or body", () => {
    expect(parseCoachTip('{"whyNow": "C"}')).toBeNull();
  });

  it("rejects text that is not JSON at all", () => {
    expect(parseCoachTip("Sure, here is some advice.")).toBeNull();
  });
});

describe("generateCoachTip", () => {
  it("writes nothing and calls no model when there isn't enough send history", async () => {
    const { workspace, user } = await makeWorkspace("Coach");
    created.workspaceIds.push(workspace.id);
    created.userIds.push(user.id);

    const result = await generateCoachTip(workspace.id, user.id);
    expect(result).toEqual({ ok: true, created: false, reason: "insufficient_data" });

    const rows = await db.aIInsight.findMany({ where: { workspaceId: workspace.id, kind: "COACH_TIP" } });
    expect(rows).toHaveLength(0);
  });
});
