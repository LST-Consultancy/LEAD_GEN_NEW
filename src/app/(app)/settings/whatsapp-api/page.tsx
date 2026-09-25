import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { getChannelReach } from "@/lib/services/channels";
import { whatsappStatus } from "@/lib/services/whatsapp";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { WhatsAppView } from "@/components/integrations/whatsapp-view";

export const metadata: Metadata = { title: "WhatsApp API" };

export default async function Page() {
  const ctx = await requireAuth();
  const [reach, conversationCount, connection] = await Promise.all([
    getChannelReach(ctx, "whatsapp"),
    db.conversation.count({ where: { workspaceId: ctx.workspaceId, channel: "WHATSAPP" } }),
    whatsappStatus(ctx),
  ]);

  return (
    <WhatsAppView
      variant="api"
      reach={reach}
      connection={connection}
      canManage={ctx.permissions.includes(PERMISSIONS.WORKSPACE_MANAGE)}
      conversationCount={conversationCount}
    />
  );
}
