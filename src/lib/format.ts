/**
 * Indian numbering conventions throughout: lakh (10^5) and crore (10^7) with
 * 2,2,3 digit grouping. `en-IN` handles the grouping; the compact forms are
 * hand-rolled because Intl's compact notation renders "43L" inconsistently
 * across engines.
 */

const inrFull = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrFullPaise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatInr(amount: number, opts: { paise?: boolean } = {}): string {
  return (opts.paise ? inrFullPaise : inrFull).format(amount);
}

/** ₹42.8L / ₹1.24Cr / ₹8,400 — the dense form used in tiles and cards. */
export function formatInrCompact(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1e7) return `${sign}₹${trimZero(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trimZero(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(abs)}`;
  return `${sign}₹${abs.toFixed(0)}`;
}

function trimZero(n: number): string {
  const fixed = n >= 100 ? n.toFixed(0) : n.toFixed(n >= 10 ? 1 : 2);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

export function formatPercent(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}

/**
 * Relative timestamps are rendered on the server and then again on the client at
 * hydration. Reading `Date.now()` on both sides means any render straddling a
 * boundary ("just now" then "1m ago") produces a hydration mismatch.
 *
 * Flooring the reference to the start of the current minute makes both renders
 * agree, and costs nothing: an age expressed in minutes, hours or days never
 * needed sub-minute precision.
 */
export function stableNow(now?: Date): number {
  const ms = (now ?? new Date()).getTime();
  return Math.floor(ms / 60_000) * 60_000;
}

/** Whole hours since `date`, using the same stable reference as formatAge. */
export function hoursSince(date: Date | string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  return Math.max(0, Math.round((stableNow() - d.getTime()) / 3_600_000));
}

/** True when a due date has passed. Quantised so SSR and hydration agree. */
export function isPast(date: Date | string | null): boolean {
  if (!date) return false;
  const d = typeof date === "string" ? new Date(date) : date;
  return d.getTime() < stableNow();
}

const RELATIVE_STEPS: [limit: number, div: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60, 1, "second"],
  [3600, 60, "minute"],
  [86_400, 3600, "hour"],
  [604_800, 86_400, "day"],
  [2_629_800, 604_800, "week"],
  [31_557_600, 2_629_800, "month"],
  [Infinity, 31_557_600, "year"],
];

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelative(date: Date | string, now?: Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const deltaSec = (d.getTime() - stableNow(now)) / 1000;
  const abs = Math.abs(deltaSec);
  for (const [limit, div, unit] of RELATIVE_STEPS) {
    if (abs < limit) return rtf.format(Math.round(deltaSec / div), unit);
  }
  return d.toLocaleDateString("en-IN");
}

/** "2h ago" style — tighter than formatRelative, for dense table cells. */
export function formatAge(date: Date | string | null, now?: Date): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const sec = Math.max(0, (stableNow(now) - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`;
  const days = Math.floor(sec / 86_400);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function formatDate(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(date: Date | string | null, timezone = "Asia/Kolkata"): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

export function formatTime(date: Date | string, timezone = "Asia/Kolkata"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

export function daysBetween(a: Date | string, b: Date | string = new Date()): number {
  const da = typeof a === "string" ? new Date(a) : a;
  const dbb = typeof b === "string" ? new Date(b) : b;
  return Math.floor(Math.abs(dbb.getTime() - da.getTime()) / 86_400_000);
}

export function greeting(now: Date = new Date(), timezone = "Asia/Kolkata"): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: timezone }).format(now)
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The instant a calendar day (YYYY-MM-DD) begins in a timezone. A date filter
 * "from the 3rd" means from midnight on the 3rd where the workspace is, not
 * midnight UTC — which in IST is 05:30 and would drop the morning's leads.
 */
export function startOfLocalDay(dateKey: string, timezone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // The zone's offset at that moment, read back from how the zone displays it.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(guess - (shown - guess));
}
