import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { listLists } from "@/lib/services/lists";
import { ListsView } from "@/components/intelligence/lists-view";

export const metadata: Metadata = { title: "Lists" };

export default async function ListsPage() {
  const ctx = await requireAuth();
  return <ListsView lists={await listLists(ctx)} />;
}
