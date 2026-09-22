import type { Metadata } from "next";
import Link from "next/link";
import { NAV } from "@/lib/nav";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsIndexPage() {
  const adminGroup = NAV.find((g) => g.key === "admin");
  const items = (adminGroup?.items ?? []).filter(
    (i) => i.href.startsWith("/settings/") || ["/archived", "/recycle-bin", "/trust"].includes(i.href)
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-primary">Settings</h1>
        <p className="mt-0.5 text-xs text-secondary">
          Workspace configuration, integrations and platform access. Sections marked{" "}
          <span className="inline-flex items-center gap-1 align-middle">
            <span className="inline-block size-1 rounded-full bg-border-strong" />
            <span className="text-muted">grey</span>
          </span>{" "}
          aren&apos;t built yet and say so when opened.
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Link key={item.key} href={item.href} className="block">
            <Card className="h-full transition-colors hover:border-border-strong hover:bg-surface-hover">
              <CardContent className="pt-3.5">
                <div className="flex items-center gap-2">
                  <item.icon className="size-3.5 shrink-0 text-muted" />
                  <span className="text-xs font-semibold text-primary">{item.label}</span>
                  {item.status === "planned" ? (
                    <span className="ml-auto rounded border border-border bg-surface-sunken px-1 text-2xs text-muted">
                      {item.phase}
                    </span>
                  ) : (
                    <span className="ml-auto rounded border border-success-border bg-success-subtle px-1 text-2xs text-success-text">
                      Live
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-2xs leading-relaxed text-secondary">{item.purpose}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
