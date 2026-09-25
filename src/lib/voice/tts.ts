import "server-only";
import { validateProviderUrl } from "@/lib/providers/http";

/**
 * Server text-to-speech through OpenAI's audio speech endpoint (`POST /v1/audio/speech`), used only
 * when OPENAI_API_KEY is set. Returns MP3 bytes. Nothing is sent to anyone: the audio goes back to
 * the person who asked for it.
 */
export const TTS_VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"] as const;
export const ttsAvailable = () => Boolean(process.env.OPENAI_API_KEY);

export async function synthesizeSpeech(text: string, voice: (typeof TTS_VOICES)[number]): Promise<{ ok: true; audio: Buffer } | { ok: false; reason: string }> {
  if (!ttsAvailable()) return { ok: false, reason: "No speech provider is configured on the server (OPENAI_API_KEY), so audio cannot be generated for download. Use Listen to hear it in your browser." };
  const url = validateProviderUrl("https://api.openai.com/v1/audio/speech");
  try {
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice, input: text.slice(0, 4000), response_format: "mp3" }), redirect: "error", signal: AbortSignal.timeout(60_000), cache: "no-store" });
    if (!res.ok) { await res.body?.cancel(); return { ok: false, reason: res.status === 401 ? "The speech provider refused the API key." : res.status === 429 ? "The speech provider's rate or quota limit was reached. Try again later." : `The speech provider refused the request (HTTP ${res.status}).` }; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 20_000_000) return { ok: false, reason: "The audio came back larger than expected and was not kept." };
    return { ok: true, audio: buf };
  } catch { return { ok: false, reason: "The speech provider could not be reached." }; }
}
