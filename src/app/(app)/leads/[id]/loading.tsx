import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function DossierLoading() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Loading lead
      </span>
      <div className="border-b border-border bg-surface px-4 py-3">
        <Skeleton className="mb-2 h-5 w-20" />
        <div className="flex gap-3">
          <Skeleton className="size-20 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-80" />
          </div>
          <Skeleton className="size-16 rounded-full" />
        </div>
        <div className="mt-3 flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-md" />
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] px-4 py-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-3">
            <Card>
              <CardHeader>
                <Skeleton className="h-3 w-24" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-14 w-full rounded-lg" />
                <SkeletonText lines={4} />
              </CardContent>
            </Card>
            <div className="grid gap-3 md:grid-cols-2">
              <Card>
                <CardContent className="pt-4">
                  <Skeleton className="mx-auto size-56 rounded-full" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <Skeleton className="h-3 w-28" />
                </CardHeader>
                <CardContent>
                  <SkeletonText lines={6} />
                </CardContent>
              </Card>
            </div>
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-3 w-24" />
                </CardHeader>
                <CardContent>
                  <SkeletonText lines={3} />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
