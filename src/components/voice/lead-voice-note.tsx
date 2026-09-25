"use client";
import * as React from "react";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VoicePlayer } from "./voice-player";

/** A voice-note draft for this lead, loaded when asked for. */
export function LeadVoiceNote({ leadId }: { leadId: string }) {
  const [data, setData] = React.useState<{ script: string; serverAudio: boolean; voices: string[] } | null>(null);
  const [error, setError] = React.useState("");
  return <Card><CardHeader><CardTitle>Voice note</CardTitle></CardHeader><CardContent className="pt-0">
    {data ? <VoicePlayer script={data.script} serverAudio={data.serverAudio} voices={data.voices} purpose="voice_note" editable title="Draft" />
      : <Button size="sm" variant="outline" onClick={() => api.get<typeof data>(`/api/leads/${leadId}/voice-note`).then(setData, e => setError(e instanceof Error ? e.message : "Could not draft it."))}>Draft a voice note</Button>}
    {error && <p className="mt-1 text-2xs text-danger-text">{error}</p>}
  </CardContent></Card>;
}
