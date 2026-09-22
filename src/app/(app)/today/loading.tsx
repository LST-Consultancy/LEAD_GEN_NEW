import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function TodayLoading() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-3 px-3 py-3 sm:px-4 sm:py-4" aria-busy="true">
      <span className="sr-only" role="status">
        Loading your day
      </span>

      <div className="rounded-xl border border-ai-border bg-ai-surface p-5">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-2 h-3 w-72" />
        <Skeleton className="mt-4 h-3 w-full" />
        <Skeleton className="mt-1.5 h-3 w-4/5" />
        <div className="mt-5 grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-4 w-8" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <Card>
            <CardHeader>
              <Skeleton className="h-3 w-28" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3">
                <Skeleton className="size-14 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="size-12 rounded-full" />
              </div>
              <Skeleton className="h-20 w-full rounded-lg" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Skeleton className="h-3 w-32" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Skeleton className="h-3 w-24" />
            </CardHeader>
            <CardContent className="space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <Skeleton className="size-5 rounded" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-3/5" />
                    <Skeleton className="h-2.5 w-2/5" />
                  </div>
                  <Skeleton className="h-7 w-16 rounded-md" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-3 w-24" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
