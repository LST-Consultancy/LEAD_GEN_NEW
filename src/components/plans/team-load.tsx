import Link from "next/link";
import type { RouteMember } from "@/lib/teamcollab/routing";

/** Each person's open plan steps against their capacity — the same figures routing decides on. */
export function TeamLoad({ members }: { members: RouteMember[] }) {
  if (!members.length) return null;
  const sorted = [...members].sort((a, b) => (b.stepCapacity ? b.openSteps / b.stepCapacity : 0) - (a.stepCapacity ? a.openSteps / a.stepCapacity : 0) || b.openSteps - a.openSteps);
  return <section className="rounded-lg border border-border bg-surface p-3 text-xs" aria-label="Team load">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold text-primary">Team load</h2><Link href="/settings/team" className="text-2xs text-secondary underline">Set skills and capacity</Link></div>
    <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{sorted.map(m => {
      const pct = m.stepCapacity ? Math.min(100, Math.round((m.openSteps / m.stepCapacity) * 100)) : null;
      return <li key={m.userId} className="min-w-0 rounded border border-border px-2 py-1.5">
        <div className="flex items-baseline justify-between gap-2"><span className="truncate font-medium text-primary">{m.name}</span><span className="shrink-0 tabular-nums text-secondary">{m.openSteps}{m.stepCapacity ? ` / ${m.stepCapacity}` : ""} open{m.isAway ? " · away" : ""}</span></div>
        {pct !== null ? <div className="mt-1 h-1.5 rounded bg-surface-sunken" role="img" aria-label={`${pct}% of capacity`}><div className={`h-1.5 rounded ${pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-success"}`} style={{ width: `${pct}%` }} /></div> : <p className="mt-0.5 text-2xs text-muted">No capacity set</p>}
        <p className="mt-0.5 truncate text-2xs text-muted">{m.skills.length ? m.skills.join(", ") : "No skills set — offered only steps that need none"}</p>
      </li>;
    })}</ul>
  </section>;
}
