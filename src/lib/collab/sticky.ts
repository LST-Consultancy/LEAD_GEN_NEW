/**
 * Shared client/server shapes for the sticky-note board.
 *
 * DB-free on purpose, following `lib/leads/filter.ts`: the board is a client
 * component and needs the kind and colour lists as *values*, not just types.
 * Importing them from the service pulled `server-only` into the client bundle,
 * which 500s every page sharing that chunk — not just this one.
 */

export const STICKY_KINDS = ["IDEA", "REMINDER", "OBJECTION", "FOLLOW_UP", "PERSONAL"] as const;
export const STICKY_COLORS = ["amber", "teal", "violet", "rose", "slate"] as const;

export type StickyKind = (typeof STICKY_KINDS)[number];
export type StickyColor = (typeof STICKY_COLORS)[number];

export type StickyNote = {
  id: string;
  kind: string;
  body: string;
  color: string;
  isPinned: boolean;
  authorName: string;
  isMine: boolean;
  leadId: string | null;
  createdAt: string;
  updatedAt: string;
};
