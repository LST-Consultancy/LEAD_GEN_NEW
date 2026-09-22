import Link from "next/link";
import { NAV } from "@/lib/nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const adminGroup = NAV.find((g) => g.key === "admin");
  const items = (adminGroup?.items ?? []).filter((i) => i.href.startsWith("/settings/"));

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-3 sm:px-4 sm:py-4">
      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Settings sub-nav. Hidden on small screens where the main sidebar already lists these. */}
        <nav aria-label="Settings sections" className="hidden lg:block">
          <p className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-wider text-muted">
            Settings
          </p>
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-secondary transition-colors hover:bg-surface-hover hover:text-primary"
                >
                  <item.icon className="size-3.5 shrink-0 text-muted" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.status === "planned" ? (
                    <span
                      className="size-1 shrink-0 rounded-full bg-border-strong"
                      title="Not built yet"
                    />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
