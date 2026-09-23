import { type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { unauthorized, handleApiError } from "@/lib/api/respond";
import { exportOpportunities } from "@/lib/services/opportunity-export";
export async function GET(req: NextRequest) { try { const ctx=await getAuthContext();if(!ctx)return unauthorized();return new Response(await exportOpportunities(ctx,Object.fromEntries(req.nextUrl.searchParams)),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=opportunities.csv","Cache-Control":"no-store"}}); } catch(e){return handleApiError(e);} }
