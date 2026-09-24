import "server-only";
import { db } from "@/lib/db";

/** The seeded demo sign-in. Shown on the sign-in page only when it really exists. */
export const DEMO_ACCOUNT = { email: "rahul@northbridge.example", password: "Signalroom123" } as const;

/**
 * Whether this database is the seeded demo. A production database cleaned of
 * demo data must not advertise credentials that no longer work, or describe
 * its real customers as fictional.
 */
export async function demoAccountExists(): Promise<boolean> {
  const user = await db.user.findUnique({ where: { email: DEMO_ACCOUNT.email }, select: { deletedAt: true } });
  return Boolean(user && !user.deletedAt);
}
