"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api/client";

/** The scheduling page prospects are sent to. Stored on the workspace; validated as https. */
export function BookingUrlForm({ initial, canEdit }: { initial: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = React.useState(initial ?? "");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const dirty = value.trim() !== (initial ?? "");

  async function save() {
    setPending(true); setError("");
    try {
      await api.put("/api/workspace/settings", { bookingUrl: value.trim() });
      toast.success(value.trim() ? "Booking link saved" : "Booking link removed");
      router.refresh();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Not saved. Nothing was changed."); }
    finally { setPending(false); }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Booking link</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">Your Calendly, Cal.com or Google appointment page. Offered when booking a meeting, so prospects can pick a slot themselves.</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Input aria-label="Booking link" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://cal.com/your-name/30min" disabled={!canEdit || pending} />
          {canEdit ? <Button variant="primary" size="sm" loading={pending} disabled={!dirty} onClick={() => void save()}>Save</Button> : null}
        </div>
        {error ? <p className="text-xs text-danger-text">{error}</p> : null}
        {!canEdit ? <p className="text-2xs text-muted">Only an owner can change workspace settings.</p> : null}
      </CardContent>
    </Card>
  );
}
