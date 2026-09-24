import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/context";
import { listSequences } from "@/lib/services/sequences";
import { SequenceEditor } from "@/components/outreach/sequence-editor";

export const metadata: Metadata = { title: "Edit sequence" };

export default async function EditSequencePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  const { id } = await params;
  const s = (await listSequences(ctx)).find((x: { id: string }) => x.id === id);
  if (!s) notFound();
  return (
    <SequenceEditor
      initial={{
        id: s.id, name: s.name, description: s.description ?? "", stopOnReply: s.stopOnReply, stopOnUnsubscribe: s.stopOnUnsubscribe,
        sendWindowStart: s.sendWindowStart, sendWindowEnd: s.sendWindowEnd, sendDays: s.sendDays, timezone: s.timezone, dailyCap: s.dailyCap,
        steps: s.steps.map((st: { dayOffset: number; channel: string; isManualTask: boolean; subject: string | null; bodyTemplate: string }) => ({ dayOffset: st.dayOffset, channel: st.channel, isManualTask: st.isManualTask, subject: st.subject, bodyTemplate: st.bodyTemplate })),
      }}
    />
  );
}
