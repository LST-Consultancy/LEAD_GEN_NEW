import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { listIcpProfiles } from "@/lib/services/icp";
import { getFilterFacets } from "@/lib/services/leads";
import { IcpEditor } from "@/components/icp/icp-editor";

export const metadata: Metadata = { title: "ICP" };

export default async function IcpPage() {
  const ctx = await requireAuth();
  const [profiles, facets] = await Promise.all([listIcpProfiles(ctx), getFilterFacets(ctx)]);

  return (
    <IcpEditor
      profiles={profiles}
      facets={{
        industries: facets.industries,
        cities: facets.cities,
        states: facets.states,
        technologies: facets.technologies,
        seniorities: facets.seniorities,
        departments: facets.departments,
      }}
    />
  );
}
