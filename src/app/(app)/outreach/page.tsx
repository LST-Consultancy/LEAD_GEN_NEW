import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { listSequences } from "@/lib/services/sequences";
import {
  EMAIL_PROVIDERS,
  EMAIL_NOT_CONFIGURED,
  REPLIES_NOT_READABLE,
  activeEmailProvider,
  canReceiveReplies,
  isEmailConfigured,
} from "@/lib/outreach/provider";
import { OutreachView } from "@/components/outreach/outreach-view";

export const metadata: Metadata = { title: "Outreach" };

export default async function OutreachPage() {
  const ctx = await requireAuth();
  const [sequences, suppressionCount] = await Promise.all([
    listSequences(ctx),
    db.suppression.count({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  return (
    <OutreachView
      sequences={sequences}
      suppressionCount={suppressionCount}
      provider={{
        configured: isEmailConfigured(),
        provider: activeEmailProvider(),
        canReceive: canReceiveReplies(),
        notConfiguredMessage: EMAIL_NOT_CONFIGURED,
        repliesNotReadableMessage: REPLIES_NOT_READABLE,
        catalogue: Object.values(EMAIL_PROVIDERS),
      }}
    />
  );
}
