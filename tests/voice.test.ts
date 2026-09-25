import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { briefingScript, voiceNoteScript } from "@/lib/voice/briefing";
import { generateSpeech, morningBriefing } from "@/lib/services/voice";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("spoken scripts", () => {
  it("reads only the figures it is given, and says so when there is nothing", () => {
    expect(briefingScript({ firstName: "Asha", clauses: [], worklist: [], totalChanges: 0 })).toBe("Good morning, Asha. Nothing changed overnight that needs you. Your worklist is empty. That's the briefing.");
    const s = briefingScript({ firstName: "Asha", clauses: [{ text: "2 replies need you" }], worklist: [{ title: "Call Meera", reason: "Proposal viewed twice." }], totalChanges: 2 });
    expect(s).toContain("Since yesterday: 2 replies need you.");
    expect(s).toContain("1. Call Meera, because Proposal viewed twice.");
    expect(voiceNoteScript({ leadFirstName: "Meera", company: "Contoso", senderName: "Asha", senderCompany: "LST", reason: null })).toContain("Hi Meera, this is Asha from LST.");
  });
});

describe("speech generation", () => {
  it("builds the briefing from the workspace, refuses download without a provider, and audits a generation", async () => {
    const w = await makeWorkspace("Voice"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    vi.stubEnv("OPENAI_API_KEY", "");
    const b = await morningBriefing(w.ctx);
    expect(b).toMatchObject({ serverAudio: false, script: expect.stringContaining("Good morning") });
    await expect(generateSpeech(w.ctx, { text: b.script, purpose: "briefing" })).rejects.toThrow(/No speech provider/);
    vi.stubEnv("OPENAI_API_KEY", "sk-synthetic");
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([0xff, 0xf3, 0x44, 0xc4]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const audio = await generateSpeech(w.ctx, { text: b.script, voice: "nova", purpose: "briefing" });
    expect(audio.length).toBe(4);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ voice: "nova", response_format: "mp3" });
    expect(await db.auditLog.count({ where: { workspaceId: w.workspace.id, action: "voice.generated" } })).toBe(1);
  });
});
