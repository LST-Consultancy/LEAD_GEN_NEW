import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { getChannelReach } from "@/lib/services/channels";
import { whatsappCredentials, WHATSAPP_ADAPTER_BUILT } from "@/lib/channels/whatsapp";
import { WhatsAppView } from "@/components/integrations/whatsapp-view";

export const metadata: Metadata = { title: "WhatsApp" };

export default async function Page() {
  const ctx = await requireAuth();
  const [reach, conversationCount] = await Promise.all([
    getChannelReach(ctx, "whatsapp"),
    db.conversation.count({ where: { workspaceId: ctx.workspaceId, channel: "WHATSAPP" } }),
  ]);

  return (
    <WhatsAppView
      variant="channel"
      reach={reach}
      credentials={whatsappCredentials()}
      adapterBuilt={WHATSAPP_ADAPTER_BUILT}
      conversationCount={conversationCount}
    />
  );
}
