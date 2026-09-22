import { notFound } from "next/navigation";
import { NotBuiltYet } from "@/components/ui/states";
import { navItemByKey } from "@/lib/nav";

/**
 * §126 — routes whose backend isn't built render an honest placeholder that
 * names the intended function and phase, rather than a dashboard of invented
 * numbers. The copy comes from the same nav config that drives the sidebar, so
 * a screen can never claim to do something the nav doesn't describe.
 */
export function PlannedPage({ navKey }: { navKey: string }) {
  const item = navItemByKey(navKey);
  if (!item) notFound();

  return (
    <NotBuiltYet
      feature={item.label}
      phase={item.phase}
      description={item.purpose}
      planned={item.planned}
    />
  );
}
