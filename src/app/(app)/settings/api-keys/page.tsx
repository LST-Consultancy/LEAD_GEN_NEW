import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getApiSurface, listApiKeys } from "@/lib/services/api-keys";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiKeysView } from "@/components/integrations/api-keys-view";

export const metadata: Metadata = { title: "API Keys" };

export default async function ApiKeysPage() {
  const ctx = await requireAuth();
  const keys = await listApiKeys(ctx);

  return (
    <ApiKeysView
      keys={keys}
      surface={getApiSurface(ctx)}
      canManage={ctx.permissions.includes(PERMISSIONS.API_KEYS_MANAGE)}
    />
  );
}
