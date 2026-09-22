"use client";

import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Kbd } from "@/components/ui/kbd";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-card">
        <EmptyState
          icon={Compass}
          title="That page doesn't exist"
          description="The link may be stale, or the record may have been deleted or archived. Nothing has changed in your workspace."
          action={
            <Button asChild variant="primary" size="sm">
              <Link href="/today">Back to Today</Link>
            </Button>
          }
          secondaryAction={
            <span className="text-xs text-muted">
              or press <Kbd>⌘</Kbd>
              <Kbd>K</Kbd> to search
            </span>
          }
        />
      </div>
    </div>
  );
}
