import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { Wordmark } from "@/components/shell/brandmark";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  if (ctx) redirect("/today");

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,460px)]">
      {/* Narrative panel — hidden on small screens where it would just be noise. */}
      <div className="relative hidden flex-col justify-between border-r border-border bg-surface-sunken p-10 lg:flex">
        <Link href="/">
          <Wordmark />
        </Link>

        <div className="max-w-md space-y-6">
          <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight text-primary">
            Right buyer. Right timing. Right context. Right action.
          </h1>
          <p className="text-sm leading-relaxed text-secondary">
            Signalroom watches for the moment a business starts looking for what you sell, works out
            whether they fit, and tells you what to do about it — with the evidence attached.
          </p>

          <ol className="space-y-3 border-t border-border pt-6">
            {[
              ["Signal", "A public post, a job opening, a tender, a tech change."],
              ["Evidence", "Eight scored dimensions, each with its reasoning shown."],
              ["Action", "One ranked worklist instead of a wall of leads."],
              ["Revenue", "Traced back to the signal that started it."],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border border-border bg-surface text-2xs font-semibold tabular text-muted">
                  {i + 1}
                </span>
                <span>
                  <span className="block text-xs font-semibold text-primary">{title}</span>
                  <span className="block text-xs leading-relaxed text-secondary">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-2xs text-muted">
          Demo workspace contains fictional companies and people for evaluation only.
        </p>
      </div>

      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mb-8 lg:hidden">
          <Wordmark />
        </div>
        {children}
      </div>
    </div>
  );
}
