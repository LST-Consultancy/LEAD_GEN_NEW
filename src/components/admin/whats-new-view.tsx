"use client";

import Link from "next/link";
import { Info, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ChangelogEntry } from "@/lib/changelog";

/**
 * What's New.
 *
 * Every entry carries what it still cannot do. A changelog that lists only
 * arrivals trains people to expect more than shipped, and the first time they
 * hit the gap they stop trusting the list.
 */
export function WhatsNewView({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">What&apos;s New</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          What has shipped, and what each one still cannot do. An entry with no caveat means
          nothing is withheld.
        </p>
      </div>

      <div className="space-y-2">
        {entries.map((e) => (
          <Card key={e.title}>
            <CardContent className="space-y-1 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Sparkles className="size-3.5 text-muted" />
                <span className="text-xs font-medium text-primary">{e.title}</span>
                <Badge variant="neutral" size="sm">
                  {e.area}
                </Badge>
                {e.caveat ? null : (
                  <Badge variant="success" size="sm">
                    Complete
                  </Badge>
                )}
              </div>
              <p className="text-2xs leading-relaxed text-secondary">{e.body}</p>
              {e.caveat ? (
                <p className="text-2xs leading-relaxed text-warning-text">
                  <strong>Still can&apos;t:</strong> {e.caveat}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-2xs leading-relaxed text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        Anything routed but not built says so on its own screen too, so you never have to come here
        to find out whether something works.{" "}
        <Link href="/support" className="text-brand-text underline-offset-2 hover:underline">
          Support
        </Link>{" "}
        lists what this workspace has connected right now.
      </p>
    </div>
  );
}
