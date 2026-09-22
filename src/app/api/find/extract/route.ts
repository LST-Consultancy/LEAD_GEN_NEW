import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { extractIcp } from "@/lib/icp/extract";
import { previewIcpMatch } from "@/lib/services/icp";
import { handleApiError, unauthorized } from "@/lib/api/respond";

const schema = z.object({ text: z.string().trim().min(10).max(4000) });

/**
 * Turns prose into an ICP draft and counts what it would match.
 *
 * Read-only and free of side effects — nothing is saved until the user confirms
 * the draft, because a definition they have not checked is worse than none.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { text } = schema.parse(await req.json());

    const extraction = extractIcp(text);
    const preview = await previewIcpMatch(ctx, {
      name: "Draft",
      sellsDescription: extraction.draft.sellsDescription,
      industries: extraction.draft.industries,
      locations: extraction.draft.locations,
      employeeMin: extraction.draft.employeeMin,
      employeeMax: extraction.draft.employeeMax,
      buyerRoles: extraction.draft.buyerRoles,
      seniorities: extraction.draft.seniorities,
      technologies: extraction.draft.technologies,
      pains: [],
      triggerEvents: extraction.draft.triggerEvents,
      exclusions: extraction.draft.exclusions,
    });

    return NextResponse.json({ ...extraction, preview });
  } catch (err) {
    return handleApiError(err);
  }
}
