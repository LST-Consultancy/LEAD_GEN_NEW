/**
 * §47 — LinkedIn, as an assisted workflow rather than an integration.
 *
 * There is no sanctioned API for sending connection requests or InMail from a
 * third-party tool. Every product that appears to do it is driving a browser
 * session against LinkedIn's terms, which risks the user's account — not the
 * vendor's. So this product does the honest version: it prepares the work and
 * you perform it, in LinkedIn, as yourself.
 *
 * Pure and DB-free. What is and isn't permitted is a product decision, not a
 * configuration one, so there is nothing here to switch on.
 */

export type AssistedStep = {
  order: number;
  title: string;
  detail: string;
  /** Who performs it. The point of the table is that this column is honest. */
  actor: "app" | "you";
};

export const ASSISTED_FLOW: AssistedStep[] = [
  {
    order: 1,
    title: "Pick the person",
    detail:
      "From a lead that already has a LinkedIn URL recorded. Nothing is looked up or scraped to find one.",
    actor: "app",
  },
  {
    order: 2,
    title: "Prepare the context",
    detail:
      "The signal that surfaced them, what your team has already said, and the account's open deals — so you are not writing blind.",
    actor: "app",
  },
  {
    order: 3,
    title: "Open the profile",
    detail: "A normal link, in your browser, in your own logged-in session.",
    actor: "you",
  },
  {
    order: 4,
    title: "Write and send the message",
    detail:
      "By hand, in LinkedIn. Nothing is typed, clicked or sent on your behalf, and no session cookie is ever held here.",
    actor: "you",
  },
  {
    order: 5,
    title: "Record what happened",
    detail:
      "Mark it done and the activity lands on the lead's timeline, so reporting and stop-on-reply see it like any other touch.",
    actor: "you",
  },
];

/**
 * What this product will not do, stated as a commitment rather than a gap.
 *
 * A "not built yet" implies it is coming. These are not coming, and saying so
 * is more useful than leaving a user waiting for a feature that would put
 * their account at risk.
 */
export const WILL_NOT_DO = [
  "Drive a headless browser against a logged-in LinkedIn session.",
  "Store your LinkedIn password or session cookie.",
  "Send connection requests or messages automatically, at any volume.",
  "Scrape profiles or search results to build a list.",
] as const;

/** The genuinely sanctioned surfaces, and what each would actually allow. */
export const SANCTIONED_OPTIONS = [
  {
    label: "Sales Navigator",
    allows:
      "Searching and saving leads inside LinkedIn's own product. Export is restricted, so it informs your list rather than filling it.",
    requires: "A Sales Navigator seat per user, bought from LinkedIn.",
  },
  {
    label: "LinkedIn Marketing / Conversation Ads",
    allows: "Paid message campaigns delivered by LinkedIn itself, with its own consent rules.",
    requires: "An Ads account and a campaign budget. It is advertising, not outbound.",
  },
  {
    label: "Partner APIs",
    allows: "CRM-style sync for approved partners.",
    requires: "Acceptance into LinkedIn's partner programme, which is not open to apply for.",
  },
] as const;

/** Nothing here is credentialled, and nothing needs to be. */
export const LINKEDIN_ADAPTER_BUILT = false;
