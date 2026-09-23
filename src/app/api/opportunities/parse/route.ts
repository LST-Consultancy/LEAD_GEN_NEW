import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { unauthorized,handleApiError } from "@/lib/api/respond";
import { analyzeOpportunityQuery } from "@/lib/services/opportunity-query";
export async function POST(req:NextRequest){try{const ctx=await getAuthContext();if(!ctx)return unauthorized();return NextResponse.json(await analyzeOpportunityQuery(ctx,await req.json()));}catch(e){return handleApiError(e);}}
