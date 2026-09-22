import { Skeleton } from "@/components/ui/skeleton";

export default function PipelineLoading() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <span className="sr-only" role="status">
        Loading pipeline
      </span>
      <div className="border-b border-border bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-28" />
          <div className="ml-auto flex gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-2.5 w-14" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-1 gap-2.5 overflow-hidden p-3">
        {Array.from({ length: 6 }).map((_, c) => (
          <div
            key={c}
            className="flex w-[284px] shrink-0 flex-col gap-2 rounded-lg border border-border bg-surface-sunken p-2"
          >
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: Math.max(1, 4 - (c % 3)) }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
