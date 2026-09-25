import "server-only";
/** The OAuth callback URL, from the configured public URL (APP_URL) or the request's own origin. */
export function calendarRedirectUri(requestUrl: string) {
  const base = process.env.APP_URL?.replace(/\/+$/, "") || new URL(requestUrl).origin;
  return `${base}/api/calendar/google/callback`;
}
