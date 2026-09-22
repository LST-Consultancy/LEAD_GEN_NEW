import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getWebhookCatalogue, listWebhooks } from "@/lib/services/webhooks";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { WebhooksView } from "@/components/integrations/webhooks-view";

export const metadata: Metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  const ctx = await requireAuth();
  return (
    <WebhooksView
      hooks={await listWebhooks(ctx)}
      catalogue={getWebhookCatalogue()}
      canManage={ctx.permissions.includes(PERMISSIONS.WEBHOOKS_MANAGE)}
    />
  );
}
