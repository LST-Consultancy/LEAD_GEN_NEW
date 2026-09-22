import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { findPeople, getPeopleFacets } from "@/lib/services/people";
import { PeopleFinderView } from "@/components/intelligence/people-finder-view";

export const metadata: Metadata = { title: "People Finder" };

export default async function PeopleFinderPage() {
  const ctx = await requireAuth();
  const [initial, facets] = await Promise.all([findPeople(ctx), getPeopleFacets(ctx)]);
  return <PeopleFinderView initial={initial} facets={facets} />;
}
