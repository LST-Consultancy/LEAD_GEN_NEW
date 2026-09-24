import "server-only";
import { assertPermission, type AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listOpportunities, getOpportunity, opportunityPeople } from "./opportunities";
import { MutationError } from "./mutate";
import { recordAudit } from "./audit";
import { toCsv } from "@/lib/export/csv";
export async function exportOpportunities(ctx: AuthContext, filters: unknown) {
  assertPermission(ctx, PERMISSIONS.LEADS_EXPORT);
  const page = await listOpportunities(ctx, filters);
  if (page.items.some(o => !o.sources.length || o.sources.some(s => !s.allowedExport))) throw new MutationError("This result page contains sources whose licence does not permit export. Adjust source permissions or export a permitted result set.", "export_not_permitted", 403);
  const rows: unknown[][] = [["Company","Domain","Opportunity","Opportunity Type","Intent Score","Fit Score","Posted Date","First Seen","Last Seen","Source","Source URL","Contact","Title","Email","Email Status","Phone","Industry","Employees","Location","Technologies","Evidence Summary"]];
  for (const item of page.items) {
    const o = await getOpportunity(ctx,item.id); const people = await opportunityPeople(ctx,o.companyId); const person=people[0];
    const contact = person?.person.contactMethods.find(c => ["WORK_EMAIL","PERSONAL_EMAIL"].includes(c.kind) && c.provenance && typeof c.provenance === "object" && !Array.isArray(c.provenance) && c.provenance.allowedExport === true);
    rows.push([o.company.name,o.company.domain,o.title,o.types.join("; "),o.intentScore,o.fitScore,o.postedAt,o.discoveredAt,o.lastSeenAt,o.sources.map(s=>s.provider).join("; "),o.sources.map(s=>s.sourceUrl).join("; "),contact ? person.person.fullName : "",contact ? person.title : "",contact?.value,contact?.verificationResult,"",o.company.industry,o.company.employeeCount,o.location,o.technologies.join("; "),o.evidence.map(e=>e.description).join("; ")]);
  }
  await recordAudit(ctx,{action:"opportunity.exported",objectType:"Opportunity",after:{count:page.items.length,page:page.page}});
  return toCsv(rows);
}
