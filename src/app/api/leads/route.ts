import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { listLeads } from "@/lib/services/leads";
import { leadFilterSchema } from "@/lib/leads/filter";
import { handleApiError, unauthorized } from "@/lib/api/respond";

/** Lead search for pickers: the first ten visible matches, id/name/company only. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100) || undefined;
    const result = await listLeads(ctx, leadFilterSchema.parse({ q, pageSize: 10, sort: "score" }));
    return NextResponse.json({
      leads: result.rows.map((r: { id: string; person: { name: string }; company: { name: string } }) => ({ id: r.id, name: r.person.name, company: r.company.name })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
