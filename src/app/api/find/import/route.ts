import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { importLeads, parseDelimited } from "@/lib/ingest/import";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const parseSchema = z.object({ text: z.string().min(1).max(500_000) });

/** Dry run: parses pasted text and reports what it found, changing nothing. */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { text } = parseSchema.parse(await req.json());
    const parsed = parseDelimited(text);
    if (parsed.rows.length === 0 && parsed.errors.length === 0) {
      return apiError(
        "nothing_parsed",
        "We couldn't find any rows in that. A header row naming at least 'name' and 'company' is the most reliable format.",
        400
      );
    }
    return NextResponse.json({
      ...parsed,
      // Never send back 500 rows of preview.
      rows: parsed.rows.slice(0, 20),
      totalRows: parsed.rows.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await importLeads(ctx, await req.json()), { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
