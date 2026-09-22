import { z } from "zod";

/**
 * Builds the schema for a partial update from the schema used to create.
 *
 * `schema.partial()` is not enough, and the difference is a data-loss bug.
 * `.partial()` wraps each field as optional but leaves any `.default()` in
 * place, so a field the caller omitted still comes back — as its default. Spread
 * into a Prisma `data`, that turns a one-field PATCH into a silent reset:
 * `PUT { phrase: "new text" }` on a paused watch reactivated it, reset its
 * cadence to 24h and cleared its negative keywords, because `isActive`,
 * `cadenceHours` and `negativeKeywords` all had defaults.
 *
 * This strips the default first, so an omitted field is genuinely `undefined`
 * and Prisma leaves the column alone.
 */
export function patchSchemaOf<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>
): z.ZodObject<z.ZodRawShape> {
  const shape = schema.shape as unknown as Record<string, z.ZodTypeAny>;
  const stripped: Record<string, z.ZodTypeAny> = {};

  for (const [key, field] of Object.entries(shape)) {
    stripped[key] = withoutDefault(field).optional();
  }

  return z.object(stripped);
}

/**
 * Strips `.default()` wherever it sits in the chain.
 *
 * A `.transform()` compiles to a pipe whose *input* holds the default, so
 * unwrapping only from the outside misses it: `z.array(..).default([]).
 * transform(..)` would still yield `[]` for an omitted field. This rebuilds the
 * pipe around a stripped input so the transform is kept and the default is not.
 */
function withoutDefault(field: z.ZodTypeAny): z.ZodTypeAny {
  return unwrap(field, 0);
}

function unwrap(field: z.ZodTypeAny, depth: number): z.ZodTypeAny {
  // Bounded rather than unbounded recursion: a malformed or deeply nested
  // schema must not hang the request that parses it.
  if (depth > 10) return field;

  const def = field.def as {
    type?: string;
    innerType?: z.ZodTypeAny;
    in?: z.ZodTypeAny;
    out?: z.ZodTypeAny;
  };

  if ((def.type === "default" || def.type === "prefault" || def.type === "optional") && def.innerType) {
    return unwrap(def.innerType, depth + 1);
  }

  if (def.type === "pipe" && def.in && def.out) {
    const stripped = unwrap(def.in, depth + 1);
    // Only rebuild when something was actually removed, so an ordinary pipe is
    // left exactly as the author wrote it.
    return stripped === def.in ? field : (stripped.pipe(def.out) as z.ZodTypeAny);
  }

  return field;
}
