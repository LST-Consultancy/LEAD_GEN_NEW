"use client";

import * as React from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/components/leads/bulk-actions";

/** This one lead as CSV, through the same audited export as the Leads screen. */
export function ExportLeadButton({ leadId }: { leadId: string }) {
  const [pending, setPending] = React.useState(false);
  async function run() {
    setPending(true);
    try { await downloadCsv({ leadIds: [leadId] }); toast.success("Lead exported", { description: "Locked contacts stay locked. Recorded in the audit log." }); }
    catch (err) { toast.error("Couldn't export", { description: err instanceof Error ? err.message : "Nothing was downloaded." }); }
    finally { setPending(false); }
  }
  return <Button variant="ghost" size="sm" loading={pending} onClick={() => void run()}><Download />Export</Button>;
}
