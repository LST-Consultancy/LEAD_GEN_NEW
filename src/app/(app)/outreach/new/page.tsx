import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { SequenceEditor } from "@/components/outreach/sequence-editor";

export const metadata: Metadata = { title: "New sequence" };

export default async function NewSequencePage() {
  const ctx = await requireAuth();
  return (
    <SequenceEditor
      initial={{ name: "", description: "", stopOnReply: true, stopOnUnsubscribe: true, sendWindowStart: 9, sendWindowEnd: 19, sendDays: [1, 2, 3, 4, 5], timezone: ctx.workspace.timezone ?? "Asia/Kolkata", dailyCap: 50, steps: [] }}
    />
  );
}
