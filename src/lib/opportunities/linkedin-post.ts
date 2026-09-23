import { sourceDate, type SourceDocument } from "./extractor";
import { canonicalUrl } from "./identity";

type Row = Record<string, unknown>;
const text = (...values: unknown[]) => values.find((v): v is string => typeof v === "string" && v.trim().length > 0)?.trim();
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});

function postedAt(raw: unknown): string | null {
  const v = obj(raw);
  // A timestamp is unambiguous, so it wins over a date string when both are given.
  const candidate = typeof raw === "object" && raw !== null ? (typeof v.timestamp === "number" ? v.timestamp : v.date ?? v.iso) : raw;
  if (typeof candidate !== "string") return sourceDate(candidate);
  // "2026-09-20 10:00:00" has no zone; reading it as local time would shift it by the server's offset.
  const iso = candidate.replace(" ", "T");
  return sourceDate(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(iso) ? `${iso}Z` : iso);
}

/**
 * Maps one scraped LinkedIn post. Scraper output formats differ and change without notice, so this
 * accepts the common spellings and returns null for anything it cannot read — the caller counts those.
 * The author's name and headline go into the text, because the headline is where their employer appears.
 */
export function mapLinkedInPost(item: unknown, provider: string, searchQuery: string): SourceDocument | null {
  const r = obj(item);
  const author = obj(r.author ?? r.authorProfile ?? r.actor);
  const url = text(r.post_url, r.postUrl, r.url, r.share_url, r.shareUrl, r.link);
  const body = text(r.text, r.content, r.commentary, r.post_text, r.postText);
  if (!url || !body) return null;
  let host = ""; try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const name = text(author.name, author.full_name, author.fullName, [author.first_name, author.last_name].filter(v => typeof v === "string").join(" "), r.author_name, r.authorName);
  const headline = text(author.headline, author.occupation, author.title, author.description, r.author_headline, r.authorHeadline);
  const profile = text(author.profile_url, author.profileUrl, author.url, author.linkedinUrl, r.author_profile_url, r.authorProfileUrl);
  const byline = [name, headline].filter(Boolean).join(", ");
  const sourceUrl = canonicalUrl(url);
  return {
    provider, kind: "LINKEDIN_PUBLIC_POST", externalId: sourceUrl, sourceUrl,
    title: body.replace(/\s+/g, " ").slice(0, 140), description: byline ? `${body}\n\nPosted by ${byline}` : body,
    company: { name: "" }, postedAt: postedAt(r.posted_at ?? r.postedAt ?? r.date ?? r.created_at ?? r.createdAt ?? r.time),
    status: "UNKNOWN", rawSourceReference: { searchQuery, authorName: name ?? null, authorHeadline: headline ?? null, authorProfileUrl: profile ?? null },
  };
}
