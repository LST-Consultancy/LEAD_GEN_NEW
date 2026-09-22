type DecimalLike = { toNumber(): number; toFixed(dp?: number): string };

/**
 * Prisma's Decimal is a decimal.js instance. Duck-type it rather than importing
 * from the generated client's `internal/` path, which is not a stable entrypoint.
 */
function isDecimal(value: object): value is DecimalLike {
  const v = value as Partial<DecimalLike>;
  return typeof v.toNumber === "function" && typeof v.toFixed === "function";
}

/**
 * Prisma returns Decimal instances and Date objects, neither of which can cross
 * the server/client boundary as-is. Normalise to number / ISO string once, at
 * the service layer, so React components never deal with driver types.
 */
export function toPlain<T>(value: T): Plain<T> {
  if (value === null || value === undefined) return value as Plain<T>;
  if (value instanceof Date) return value.toISOString() as Plain<T>;
  if (Array.isArray(value)) return value.map((v) => toPlain(v)) as Plain<T>;
  if (typeof value === "object") {
    if (isDecimal(value)) return value.toNumber() as Plain<T>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toPlain(v);
    }
    return out as Plain<T>;
  }
  return value as Plain<T>;
}

export type Plain<T> = T extends DecimalLike
  ? number
  : T extends Date
    ? string
    : T extends (infer U)[]
      ? Plain<U>[]
      : T extends object
        ? { [K in keyof T]: Plain<T[K]> }
        : T;
