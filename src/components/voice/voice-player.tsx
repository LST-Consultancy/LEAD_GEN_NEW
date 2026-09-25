"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * Plays a script with the browser's own speech engine (free, nothing leaves the device), with a
 * choice of voice, language and speed; and, when the server has a speech provider, downloads it as
 * MP3. Nothing is sent to anyone from here.
 */
export function VoicePlayer({ script: initial, serverAudio, voices: serverVoices, purpose, editable = false, title }: { script: string; serverAudio: boolean; voices: string[]; purpose: "briefing" | "voice_note"; editable?: boolean; title: string }) {
  const [script, setScript] = React.useState(initial);
  const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>([]);
  const [lang, setLang] = React.useState("");
  const [voiceName, setVoiceName] = React.useState("");
  const [rate, setRate] = React.useState(1);
  const [speaking, setSpeaking] = React.useState(false);
  const [serverVoice, setServerVoice] = React.useState(serverVoices[0] ?? "alloy");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  // Decided after mount: the server cannot know, and guessing differently on each side breaks hydration.
  const [supported, setSupported] = React.useState(false);
  React.useEffect(() => { setSupported("speechSynthesis" in window); }, []);
  React.useEffect(() => {
    if (!supported) return;
    const load = () => { const v = window.speechSynthesis.getVoices(); setVoices(v); if (!lang && v.length) setLang((v.find(x => x.default) ?? v[0]).lang); };
    load(); window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => { window.speechSynthesis.removeEventListener("voiceschanged", load); window.speechSynthesis.cancel(); };
  }, [supported, lang]);
  const langs = [...new Set(voices.map(v => v.lang))].sort();
  const forLang = voices.filter(v => v.lang === lang);
  function play() {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(script);
    const v = forLang.find(x => x.name === voiceName) ?? forLang[0];
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = rate; u.onend = () => setSpeaking(false); u.onerror = () => { setSpeaking(false); setMessage("Your browser could not play this voice. Try another."); };
    setSpeaking(true); window.speechSynthesis.speak(u);
  }
  async function download() {
    setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/voice/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: script, voice: serverVoice, purpose }) });
      if (!res.ok) { const e = await res.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(e?.error?.message ?? "Audio could not be generated."); }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = `${purpose === "briefing" ? "morning-briefing" : "voice-note"}.mp3`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Audio could not be generated."); } finally { setBusy(false); }
  }
  const select = "h-7 min-w-0 rounded border border-border bg-surface px-1.5 text-2xs";
  return <div className="space-y-2 text-xs">
    <p className="font-medium text-primary">{title}</p>
    {editable ? <textarea aria-label={title} value={script} onChange={e => setScript(e.target.value)} rows={4} maxLength={4000} className="block w-full rounded border border-border bg-surface p-2 text-xs" /> : <p className="text-secondary">{script}</p>}
    <div className="flex flex-wrap items-center gap-1.5">
      {supported ? <>
        <Button size="xs" variant="primary" disabled={!script.trim()} onClick={() => (speaking ? (window.speechSynthesis.cancel(), setSpeaking(false)) : play())}>{speaking ? "Stop" : "Listen"}</Button>
        {langs.length > 1 && <select aria-label="Language" value={lang} onChange={e => { setLang(e.target.value); setVoiceName(""); }} className={select}>{langs.map(l => <option key={l} value={l}>{l}</option>)}</select>}
        {forLang.length > 1 && <select aria-label="Voice" value={voiceName} onChange={e => setVoiceName(e.target.value)} className={select}>{forLang.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}</select>}
        <select aria-label="Speed" value={rate} onChange={e => setRate(Number(e.target.value))} className={select}>{[0.8, 1, 1.2, 1.5].map(r => <option key={r} value={r}>{r}×</option>)}</select>
      </> : <span className="text-muted">This browser cannot speak text aloud.</span>}
      {serverAudio ? <>
        <select aria-label="Download voice" value={serverVoice} onChange={e => setServerVoice(e.target.value)} className={select}>{serverVoices.map(v => <option key={v} value={v}>{v}</option>)}</select>
        <Button size="xs" variant="outline" loading={busy} disabled={!script.trim()} onClick={() => void download()}>Download MP3</Button>
      </> : <span className="text-2xs text-muted">Download needs a speech provider on the server.</span>}
    </div>
    {message && <p role="status" className="text-2xs text-danger-text">{message}</p>}
    {purpose === "voice_note" && <p className="text-2xs text-muted">A draft for you to edit and send yourself — nothing is sent from here.</p>}
  </div>;
}
