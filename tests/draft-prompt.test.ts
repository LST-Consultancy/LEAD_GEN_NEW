import { describe, expect, it } from "vitest";
import {
  CHANNEL_RULES,
  buildDraftPrompt,
  parseDraft,
  unknownVariables,
  variableVocabulary,
} from "@/lib/outreach/draft-prompt";
import { TEMPLATE_VARIABLES } from "@/lib/outreach/template";

describe("buildDraftPrompt", () => {
  const sections = [
    { heading: "What you sell", lines: ["Salesforce implementation, 10–16 weeks, ₹18–45 lakh"] },
    { heading: "Signals", lines: ["Posted a job for a Salesforce administrator, 4 days ago"] },
    { heading: "Empty", lines: [] },
  ];

  it("puts the grounding before the instruction to write", () => {
    const prompt = buildDraftPrompt({ channel: "email", sections });
    expect(prompt.indexOf("GROUNDING")).toBeLessThan(prompt.indexOf("Write the draft."));
  });

  it("drops sections with nothing in them rather than printing an empty heading", () => {
    expect(buildDraftPrompt({ channel: "email", sections })).not.toContain("## Empty");
  });

  it("says so plainly when there is no grounding at all", () => {
    expect(buildDraftPrompt({ channel: "email", sections: [] })).toContain("(nothing on record)");
  });

  it("carries the channel's own length rule", () => {
    for (const channel of ["email", "whatsapp", "linkedin"] as const) {
      const prompt = buildDraftPrompt({ channel, sections });
      expect(prompt).toContain(`under ${CHANNEL_RULES[channel].maxWords} words`);
    }
  });

  it("includes a requested angle, and omits the line when there isn't one", () => {
    expect(buildDraftPrompt({ channel: "email", sections, angle: "migration risk" })).toContain(
      "migration risk"
    );
    expect(buildDraftPrompt({ channel: "email", sections })).not.toContain("ANGLE THE SENDER");
  });

  it("lists every placeholder the renderer can actually substitute", () => {
    const vocab = variableVocabulary();
    for (const v of TEMPLATE_VARIABLES) expect(vocab).toContain(`{{${v.key}}}`);
  });
});

describe("parseDraft", () => {
  const good = JSON.stringify({
    subject: "Salesforce admin hire",
    body: "Hi {{first_name}}, saw the admin role at {{company}}.",
    variablesUsed: ["first_name", "company"],
    groundedOn: ["Signals"],
    withheld: null,
  });

  it("reads a well-formed reply", () => {
    expect(parseDraft(good)).toMatchObject({
      subject: "Salesforce admin hire",
      variablesUsed: ["first_name", "company"],
      withheld: null,
    });
  });

  it("tolerates a fenced code block", () => {
    // Models wrap JSON in fences often enough that failing on it would make the
    // feature flaky for no reason.
    expect(parseDraft("```json\n" + good + "\n```")).toMatchObject({ subject: "Salesforce admin hire" });
    expect(parseDraft("```\n" + good + "\n```")).toMatchObject({ subject: "Salesforce admin hire" });
  });

  it("returns null rather than throwing on anything unparseable", () => {
    for (const raw of ["", "not json", "[]", "null", "42", '{"subject":"x"}']) {
      expect(parseDraft(raw)).toBeNull();
    }
  });

  it("treats an empty body as no draft", () => {
    expect(parseDraft(JSON.stringify({ body: "   " }))).toBeNull();
  });

  it("normalises a blank subject to null rather than an empty string", () => {
    // WhatsApp and LinkedIn have no subject; "" would render as an empty field.
    expect(parseDraft(JSON.stringify({ subject: "  ", body: "hello" }))?.subject).toBeNull();
  });

  it("survives missing or wrongly-typed optional fields", () => {
    const parsed = parseDraft(JSON.stringify({ body: "hello", variablesUsed: "nope", groundedOn: 7 }));
    expect(parsed).toMatchObject({ body: "hello", variablesUsed: [], groundedOn: [] });
  });
});

describe("unknownVariables", () => {
  it("finds a placeholder the renderer cannot substitute", () => {
    // A model that invents {{pain_point}} produces copy that ships with visible
    // braces, so this has to be caught before the draft is shown.
    expect(unknownVariables("Hi {{first_name}}, about {{pain_point}}", null)).toEqual(["pain_point"]);
  });

  it("checks the subject as well as the body", () => {
    expect(unknownVariables("body", "{{made_up}}")).toEqual(["made_up"]);
  });

  it("returns nothing when every placeholder is known", () => {
    expect(unknownVariables("Hi {{first_name}} at {{company}}", "{{industry}}")).toEqual([]);
  });

  it("ignores case and inner spacing, as the renderer does", () => {
    expect(unknownVariables("{{ First_Name }}", null)).toEqual([]);
  });

  it("reports each unknown once", () => {
    expect(unknownVariables("{{x}} {{x}} {{y}}", null).sort()).toEqual(["x", "y"]);
  });
});
