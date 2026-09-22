import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";

/**
 * Conversation visibility, shared by the read and write paths.
 *
 * It lives in its own module because both `inbox.ts` and `inbox-mutations.ts`
 * need it, and duplicating a visibility rule is how the two drift apart —
 * which would let a write reach a thread the same user cannot read.
 */
export function visibilityWhereForConversation(ctx: AuthContext) {
  const filter = leadVisibilityFilter(ctx);
  if (!filter.ownerId) return {};
  return {
    OR: [
      { lead: { ownerId: filter.ownerId } },
      { AND: [{ leadId: null }, { assigneeId: filter.ownerId }] },
    ],
  };
}
