import { describe, expect, it } from "vitest";
import { z } from "zod";
import { patchSchemaOf } from "@/lib/schema/patch";

const createSchema = z.object({
  name: z.string().min(1),
  isActive: z.boolean().default(true),
  cadenceHours: z.number().int().default(24),
  tags: z
    .array(z.string().toLowerCase())
    .default([])
    .transform((t) => [...new Set(t)]),
  note: z.string().optional(),
});

describe("patchSchemaOf", () => {
  it("leaves an omitted field undefined instead of filling its default", () => {
    // This is the whole point. `.partial()` returns
    // { isActive: true, cadenceHours: 24, tags: [] } here, which spread into a
    // Prisma update would reset three columns the caller never mentioned.
    const partial = createSchema.partial().parse({ name: "x" });
    expect(partial).toMatchObject({ isActive: true, cadenceHours: 24, tags: [] });

    const patch = patchSchemaOf(createSchema).parse({ name: "x" });
    expect(patch).toEqual({ name: "x" });
    expect("isActive" in patch).toBe(false);
    expect("cadenceHours" in patch).toBe(false);
    expect("tags" in patch).toBe(false);
  });

  it("still validates the fields that are supplied", () => {
    const patch = patchSchemaOf(createSchema);
    expect(() => patch.parse({ cadenceHours: "soon" })).toThrow();
    expect(() => patch.parse({ name: "" })).toThrow();
    expect(patch.parse({ cadenceHours: 6 })).toEqual({ cadenceHours: 6 });
  });

  it("keeps a transform that sits above the default", () => {
    const patch = patchSchemaOf(createSchema);
    expect(patch.parse({ tags: ["A", "a", "B"] })).toEqual({ tags: ["a", "b"] });
  });

  it("accepts an empty patch", () => {
    expect(patchSchemaOf(createSchema).parse({})).toEqual({});
  });

  it("passing a field explicitly still sets it, including a falsy value", () => {
    const patch = patchSchemaOf(createSchema).parse({ isActive: false });
    expect(patch).toEqual({ isActive: false });
  });
});
