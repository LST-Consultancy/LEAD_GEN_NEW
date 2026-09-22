import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function LeadsLoading() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <span className="sr-only" role="status">
        Loading leads
      </span>
      <div className="shrink-0 space-y-2.5 border-b border-border bg-surface px-4 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="ml-auto h-8 w-28" />
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-6" style={{ width: `${70 + (i % 4) * 22}px` }} />
          ))}
        </div>
      </div>
      <SkeletonRows rows={16} cols={8} />
    </div>
  );
}
