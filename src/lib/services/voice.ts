import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { leadVisibilityFilter, type AuthContext } from "@/lib/auth/context";
import { MutationError, loadScoped } from "./mutate";
import { recordAudit } from "./audit";
import { rateLimit } from "@/lib/security/rate-limit";
import { getChangesSinceYesterday, getWorklist } from "./today";
import { briefingScript, voiceNoteScript } from "@/lib/voice/briefing";
import { synthesizeSpeech, TTS_VOICES, ttsAvailable } from "@/lib/voice/tts";

/** Today's spoken briefing, from the same queries as the Today screen. */
export async function morningBriefing(ctx: AuthContext) {
  const [changes, worklist] = await Promise.all([getChangesSinceYesterday(ctx), getWorklist(ctx, 3)]);
  return { script: briefingScript({ firstName: ctx.user.name.split(" ")[0], clauses: changes.clauses, totalChanges: changes.totalChanges, worklist: worklist.map(w => ({ title: w.title, reason: w.priorityReason ?? null })) }), serverAudio: ttsAvailable(), voices: [...TTS_VOICES] };
}

/** A draft voice-note script for one lead. Never sent by the app. */
export async function leadVoiceNote(ctx: AuthContext, leadId: string) {
  const lead = await loadScoped(() => db.lead.findFirst({ where: { id: leadId, workspaceId: ctx.workspaceId, deletedAt: null, ...leadVisibilityFilter(ctx) }, include: { person: { select: { fullName: true, firstName: true } }, company: { select: { name: true } } } }), "That lead");
  return { script: voiceNoteScript({ leadFirstName: lead.person.firstName ?? lead.person.fullName.split(" ")[0], company: lead.company.name, senderName: ctx.user.name, senderCompany: ctx.workspace.name, reason: lead.surfacedReason?.startsWith("Opportunity:") ? null : lead.surfacedReason }), serverAudio: ttsAvailable(), voices: [...TTS_VOICES] };
}

const speechSchema = z.object({ text: z.string().trim().min(1).max(4000), voice: z.enum(TTS_VOICES).default("alloy"), purpose: z.enum(["briefing", "voice_note"]) });
/**
 * MP3 for a script the person is looking at. Limited per user, because each call costs the
 * workspace speech-provider credit, and every generation is audited with its length.
 */
export async function generateSpeech(ctx: AuthContext, raw: unknown) {
  const input = speechSchema.parse(raw ?? {});
  const limit = await rateLimit("write", `tts:${ctx.workspaceId}:${ctx.userId}`, { limit: 20, windowSeconds: 3600 });
  if (!limit.allowed || limit.degraded) throw new MutationError("You've generated a lot of audio this hour. Try again later, or use Listen, which plays in your browser at no cost.", "rate_limited", 429);
  const r = await synthesizeSpeech(input.text, input.voice);
  await recordAudit(ctx, { action: r.ok ? "voice.generated" : "voice.failed", objectType: "Voice", after: { purpose: input.purpose, characters: input.text.length, voice: input.voice, ...(r.ok ? { bytes: r.audio.length } : { reason: r.reason }) } });
  if (!r.ok) throw new MutationError(r.reason, "tts_unavailable", 422);
  return r.audio;
}
