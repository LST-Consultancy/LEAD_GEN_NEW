"use client";

import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Kbd } from "@/components/ui/kbd";

/**
 * Scoped 404 so a missing record renders inside the app shell — the user keeps
 * their navigation instead of being dropped onto a bare page.
 *
 * Note: because this route streams, Next.js has already flushed 200 headers by
 * the time notFound() runs, so the status is 200 while the body is the 404.
 * That is a streaming trade-off, not a routing bug.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <Card>
        <EmptyState
          icon={Compass}
          title="We couldn't find that"
          description="It may have been deleted, archived, or belong to a workspace you're not a member of. Nothing in your workspace has changed."
          action={
            <Button asChild variant="primary" size="sm">
              <Link href="/leads">Back to leads</Link>
            </Button>
          }
          secondaryAction={
            <span className="text-xs text-muted">
              or press <Kbd>⌘</Kbd>
              <Kbd>K</Kbd> to search
            </span>
          }
        />
      </Card>
    </div>
  );
}
