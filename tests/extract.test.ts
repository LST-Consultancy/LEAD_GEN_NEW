import { describe, expect, it } from "vitest";
import { extractIcp, suggestPhrases } from "@/lib/icp/extract";

describe("extractIcp — the worked example from the brief", () => {
  const input =
    "I sell Salesforce implementation to Indian manufacturing businesses with 100–1000 " +
    "employees that are actively hiring Salesforce administrators or mentioning CRM migration.";
  const result = extractIcp(input);

  it("finds the industry", () => {
    expect(result.draft.industries).toContain("Manufacturing");
  });

  it("finds the geography", () => {
    expect(result.draft.locations).toContain("India");
  });

  it("reads the headcount range, including an en dash", () => {
    expect(result.draft.employeeMin).toBe(100);
    expect(result.draft.employeeMax).toBe(1000);
  });

  it("finds the technology, as something you sell rather than their stack", () => {
    // "I sell Salesforce implementation" — so Salesforce is the offering. Filing
    // it under the prospect's technologies would mean the opposite.
    expect(result.draft.sellsTechnologies).toContain("Salesforce");
    expect(result.draft.technologies).not.toContain("Salesforce");
  });

  it("finds both triggers", () => {
    expect(result.draft.triggerEvents).toContain("hiring for the role");
    expect(result.draft.triggerEvents).toContain("crm migration");
  });

  it("keeps the original text as the description", () => {
    expect(result.draft.sellsDescription).toBe(input);
  });

  it("shows the phrase behind every match, so it can be checked", () => {
    for (const m of result.matched) {
      expect(m.from.length).toBeGreaterThan(0);
      expect(input.toLowerCase()).toContain(m.from.toLowerCase());
    }
  });

  it("does not list a matched word as unmatched, even when it repeats", () => {
    // "Salesforce" appears twice in the example; matching it once must account
    // for both, or the summary contradicts itself.
    expect(result.unmatchedTerms).not.toContain("salesforce");
    expect(result.unmatchedTerms).not.toContain("manufacturing");
  });

  it("reports the fields the text said nothing about", () => {
    // Nothing here names a buyer role or an exclusion.
    expect(result.missing).toContain("exclusions");
  });
});

describe("headcount phrasing", () => {
  it.each([
    ["with 100-1000 employees", 100, 1000],
    ["with 100 to 1000 employees", 100, 1000],
    ["with 50–200 staff", 50, 200],
    ["with 1,000 to 5,000 employees", 1000, 5000],
  ])("reads %s", (text, min, max) => {
    const r = extractIcp(`selling to firms ${text}`);
    expect(r.draft.employeeMin).toBe(min);
    expect(r.draft.employeeMax).toBe(max);
  });

  it("reads an open-ended minimum", () => {
    const r = extractIcp("companies with over 500 employees");
    expect(r.draft.employeeMin).toBe(500);
    expect(r.draft.employeeMax).toBeNull();
  });

  it("reads an open-ended maximum", () => {
    const r = extractIcp("companies with under 200 employees");
    expect(r.draft.employeeMax).toBe(200);
    expect(r.draft.employeeMin).toBeNull();
  });

  it("does not invent a range when none is given", () => {
    const r = extractIcp("manufacturing companies in Pune");
    expect(r.draft.employeeMin).toBeNull();
    expect(r.draft.employeeMax).toBeNull();
    expect(r.missing).toContain("employeeMin");
  });
});

describe("geography", () => {
  it("expands a region shorthand", () => {
    const r = extractIcp("selling to logistics firms in south India");
    expect(r.draft.locations).toEqual(
      expect.arrayContaining(["Karnataka", "Tamil Nadu", "Telangana"])
    );
  });

  it("expands NCR", () => {
    const r = extractIcp("IT services companies in Delhi NCR");
    expect(r.draft.locations).toEqual(expect.arrayContaining(["Gurugram", "Noida"]));
  });

  it("reads explicit cities", () => {
    const r = extractIcp("manufacturers in Pune, Nashik and Coimbatore");
    expect(r.draft.locations).toEqual(
      expect.arrayContaining(["Pune", "Nashik", "Coimbatore"])
    );
  });
});

describe("exclusions", () => {
  it("treats a negated industry as an exclusion, not a target", () => {
    const r = extractIcp("manufacturing companies but not staffing or education firms");
    expect(r.draft.industries).toContain("Manufacturing");
    expect(r.draft.exclusions).toContain("Education");
    expect(r.draft.industries).not.toContain("Education");
  });

  it("handles 'excluding'", () => {
    const r = extractIcp("logistics businesses, excluding hospitality");
    expect(r.draft.exclusions).toContain("Hospitality");
  });
});

describe("roles and seniority", () => {
  it("canonicalises role titles", () => {
    const r = extractIcp("we sell to the IT head and the CFO");
    expect(r.draft.buyerRoles).toEqual(expect.arrayContaining(["Head of IT", "CFO"]));
  });

  it("derives seniority", () => {
    const r = extractIcp("targeting founders and VPs at SaaS companies");
    expect(r.draft.seniorities).toEqual(expect.arrayContaining(["founder", "vp"]));
  });
});

describe("honesty about what it did not understand", () => {
  it("reports leftover terms rather than pretending to comprehend", () => {
    const r = extractIcp(
      "We sell bespoke quantum annealing middleware to manufacturing firms in Pune"
    );
    expect(r.draft.industries).toContain("Manufacturing");
    // The made-up jargon must surface as unmatched, not be silently dropped.
    expect(r.unmatchedTerms.join(" ")).toMatch(/quantum|annealing|middleware/);
  });

  it("returns an empty draft and full missing list for meaningless input", () => {
    const r = extractIcp("asdf qwerty zxcv");
    expect(r.draft.industries).toEqual([]);
    expect(r.draft.locations).toEqual([]);
    expect(r.missing.length).toBeGreaterThanOrEqual(8);
    expect(r.matched).toEqual([]);
  });

  it("handles empty input without throwing", () => {
    const r = extractIcp("");
    expect(r.draft.industries).toEqual([]);
    expect(r.suggestedPhrases).toEqual([]);
  });
});

describe("what you sell vs what they run", () => {
  it("treats 'I sell Salesforce' as what you offer, not their stack", () => {
    const r = extractIcp("I sell Salesforce implementation to manufacturing firms");
    expect(r.draft.sellsTechnologies).toContain("Salesforce");
    // Putting it in `technologies` would mean "prospect already runs Salesforce",
    // which for an implementation partner is usually the opposite of the truth.
    expect(r.draft.technologies).not.toContain("Salesforce");
  });

  it("treats 'still running Tally' as their stack", () => {
    const r = extractIcp("manufacturers still running on Tally and Excel");
    expect(r.draft.technologies).toEqual(expect.arrayContaining(["Tally", "Excel"]));
    expect(r.draft.sellsTechnologies).not.toContain("Tally");
  });

  it("handles both in one sentence", () => {
    const r = extractIcp(
      "We implement Oracle NetSuite for distributors currently using Tally"
    );
    expect(r.draft.sellsTechnologies).toContain("Oracle NetSuite");
    expect(r.draft.technologies).toContain("Tally");
  });

  it("builds phrases from what you sell", () => {
    const r = extractIcp("I sell Salesforce implementation to manufacturers");
    const text = r.suggestedPhrases.map((p) => p.phrase).join(" ");
    expect(text).toContain("Salesforce");
  });
});

describe("suggestPhrases", () => {
  it("only builds phrases from terms that were actually matched", () => {
    const r = extractIcp("I sell Salesforce implementation to manufacturing firms in Pune");
    const text = r.suggestedPhrases.map((p) => p.phrase).join(" ").toLowerCase();
    expect(text).toContain("salesforce");
    // NetSuite was never mentioned, so it must not appear.
    expect(text).not.toContain("netsuite");
  });

  it("gives a reason for every suggestion", () => {
    const r = extractIcp("selling ERP migration to manufacturers in Gujarat");
    expect(r.suggestedPhrases.length).toBeGreaterThan(0);
    for (const p of r.suggestedPhrases) {
      expect(p.because.length).toBeGreaterThan(20);
      expect(p.sourceKind).toBeTruthy();
    }
  });

  it("suggests a tender source for tender triggers", () => {
    const r = extractIcp("we respond to tenders for ERP modernisation in Maharashtra");
    const tender = r.suggestedPhrases.find((p) => p.sourceKind === "TENDER_PORTAL");
    expect(tender).toBeDefined();
  });

  it("suggests nothing from an empty draft", () => {
    expect(
      suggestPhrases({
        sellsDescription: "",
        sellsTechnologies: [],
        industries: [],
        locations: [],
        employeeMin: null,
        employeeMax: null,
        buyerRoles: [],
        seniorities: [],
        technologies: [],
        triggerEvents: [],
        exclusions: [],
      })
    ).toEqual([]);
  });

  it("does not repeat a phrase", () => {
    const r = extractIcp(
      "Salesforce and Salesforce CRM migration for manufacturing in Pune and Mumbai"
    );
    const phrases = r.suggestedPhrases.map((p) => p.phrase);
    expect(new Set(phrases).size).toBe(phrases.length);
  });
});

describe("nothing understood is reported as not understood", () => {
  it("does not list a trigger word it matched on a sibling pattern", () => {
    // "raised" and "funding" are both patterns for the same trigger. Matching
    // on "raised" used to leave "funding" under unmatchedTerms.
    const r = extractIcp("Best when they just raised funding.");
    expect(r.draft.triggerEvents).toContain("funding");
    expect(r.unmatchedTerms).not.toContain("funding");
    expect(r.unmatchedTerms).not.toContain("raised");
  });

  it("does not list the cue that decided sell-versus-stack", () => {
    const r = extractIcp("We sell Salesforce implementation to manufacturers.");
    expect(r.draft.sellsTechnologies).toContain("Salesforce");
    // "implementation" is the sell cue that put Salesforce in the sell bucket.
    expect(r.unmatchedTerms).not.toContain("implementation");
  });

  it("does not list the cue that identified the prospect's stack", () => {
    const r = extractIcp("Manufacturers migrating from SAP.");
    expect(r.draft.technologies).toContain("SAP");
    expect(r.unmatchedTerms).not.toContain("migrating");
  });

  it("consumes the whole word a stem matched", () => {
    const r = extractIcp("We target manufacturing businesses.");
    expect(r.draft.industries).toContain("Manufacturing");
    // The stem is "manufactur"; the "ing" tail must not leak.
    expect(r.unmatchedTerms.join(" ")).not.toMatch(/manufactur/);
  });

  it("still reports words it genuinely did not understand", () => {
    const r = extractIcp("We target manufacturing firms with excellent synergy.");
    expect(r.unmatchedTerms).toContain("synergy");
  });
});

describe("suggested phrases point the right way", () => {
  it("suggests partner and hiring phrases for what you sell", () => {
    const { suggestedPhrases } = extractIcp("We sell Salesforce implementation.");
    const phrases = suggestedPhrases.map((p) => p.phrase);
    expect(phrases).toContain("looking for Salesforce implementation partner");
    expect(phrases).toContain("hiring Salesforce administrator");
  });

  it("suggests migration phrases for what your prospects already run", () => {
    const { suggestedPhrases } = extractIcp("Manufacturers migrating from SAP.");
    const phrases = suggestedPhrases.map((p) => p.phrase);
    expect(phrases).toContain("migrating from SAP");
    expect(phrases).toContain("SAP replacement");
    // The inverse would find companies investing IN SAP — the wrong companies.
    expect(phrases).not.toContain("looking for SAP implementation partner");
    expect(phrases).not.toContain("hiring SAP administrator");
  });

  it("keeps the two directions apart in one sentence", () => {
    const { suggestedPhrases } = extractIcp(
      "We sell Salesforce implementation to manufacturers migrating from SAP."
    );
    const phrases = suggestedPhrases.map((p) => p.phrase);
    expect(phrases).toContain("looking for Salesforce implementation partner");
    expect(phrases).toContain("migrating from SAP");
    expect(phrases).not.toContain("looking for SAP implementation partner");
  });
});

describe("sell-versus-stack edge cases", () => {
  it("reads a bare \"X implementation\" as something you sell", () => {
    // No verb in front of it, so the word after has to carry the meaning.
    const r = extractIcp("Salesforce implementation for mid-size manufacturers.");
    expect(r.draft.sellsTechnologies).toContain("Salesforce");
    expect(r.draft.technologies).not.toContain("Salesforce");
  });

  it("does not let the next clause's cues decide this technology", () => {
    const r = extractIcp(
      "We implement Oracle NetSuite for distributors currently using Tally."
    );
    // "currently using" belongs to Tally, not to Oracle NetSuite.
    expect(r.draft.sellsTechnologies).toContain("Oracle NetSuite");
    expect(r.draft.technologies).toContain("Tally");
  });

  it("still treats a migration away as the prospect's stack", () => {
    const r = extractIcp("Manufacturers planning a SAP migration.");
    expect(r.draft.technologies).toContain("SAP");
    expect(r.draft.sellsTechnologies).not.toContain("SAP");
  });

  it("strips sentence punctuation off unmatched terms", () => {
    const r = extractIcp("We target manufacturing firms with excellent synergy.");
    expect(r.unmatchedTerms).toContain("synergy");
    expect(r.unmatchedTerms).not.toContain("synergy.");
  });
});

describe("role capture", () => {
  it("captures a VP of IT as its own role, not as Head of IT", () => {
    const r = extractIcp("I talk to VPs of IT and CFOs.");
    expect(r.draft.buyerRoles).toContain("VP IT");
    expect(r.draft.buyerRoles).toContain("CFO");
    expect(r.draft.buyerRoles).not.toContain("Head of IT");
    expect(r.draft.seniorities).toContain("vp");
  });
});
