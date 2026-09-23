import { createHash } from "node:crypto";
export function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function normalizedCompany(name: string) { return name.toLowerCase().replace(/\b(?:incorporated|inc|limited|ltd|llc|corp|corporation)\b/g, "").replace(/[^a-z0-9]/g, ""); }
export function canonicalUrl(raw: string) { const u = new URL(raw); if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) throw new Error("Invalid source URL"); u.hash = ""; for (const key of [...u.searchParams.keys()]) if (/^(utm_|ref$)/.test(key)) u.searchParams.delete(key); return u.toString(); }
export function normalizedDomain(raw?: string) { if (!raw) return null; try { return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } }
// Include the requirement title and location, rather than merging every project for a service.
export function opportunityKey(companyId: string, title: string, location?: string | null) { return hash([companyId, title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), location?.toLowerCase().trim() ?? ""]); }
