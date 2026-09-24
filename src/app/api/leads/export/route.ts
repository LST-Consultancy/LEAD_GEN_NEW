import { type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { exportLeads } from "@/lib/services/lead-bulk";

/** CSV of selected leads or the current filter. Permission is checked in the service, not the button. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { csv, filename } = await exportLeads(ctx, await req.json());
    // A byte-order mark so Excel reads non-Latin names correctly.
    return new Response(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
