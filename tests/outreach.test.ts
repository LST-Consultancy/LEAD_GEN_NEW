import { afterEach, describe, expect, it, vi } from "vitest";
import { render, variablesIn, reviewCopy, TEMPLATE_VARIABLES } from "@/lib/outreach/template";
import {
  checkSendable,
  localParts,
  nextSendWindow,
  actionableBlockers,
  type SendContext,
} from "@/lib/outreach/sendability";
import {
  EMAIL_PROVIDERS,
  isEmailConfigured,
  activeEmailProvider,
  canReceiveReplies,
} from "@/lib/outreach/provider";

const VALUES = {
  first_name: "Priya",
  full_name: "Priya Menon",
  company: "Vaitarna Steel Works",
  title: "Head of IT",
  city: "Nashik",
  industry: "Manufacturing",
  signal: "posted a job for a Salesforce administrator",
  sender_name: "Rahul Desai",
  sender_first_name: "Rahul",
  sender_company: "Northbridge Cloud",
};

describe("render", () => {
  it("substitutes known variables", () => {
    const r = render("Hi {{first_name}}, about {{company}} —", VALUES);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("Hi Priya, about Vaitarna Steel Works —");
  });

  it("tolerates whitespace and case inside the braces", () => {
    const r = render("Hi {{ First_Name }}", VALUES);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("Hi Priya");
  });

  it("refuses to render a missing value as an empty string", () => {
    // "Hi ," is the classic tell of broken automation, so this must fail.
    const r = render("Hi {{first_name}},", { ...VALUES, first_name: undefined });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.missing).toEqual(["first_name"]);
    // The placeholder is left visible so the editor can point at it.
    expect(r.text).toContain("{{first_name}}");
  });

  it("treats a whitespace-only value as missing", () => {
    const r = render("Hi {{first_name}}", { first_name: "   " });
    expect(r.ok).toBe(false);
  });

  it("reports an unknown variable rather than leaving braces for the recipient", () => {
    const r = render("Hi {{frist_name}}", VALUES);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.unknown).toEqual(["frist_name"]);
    expect(r.missing).toEqual([]);
  });

  it("reports every distinct gap once", () => {
    const r = render("{{first_name}} {{first_name}} {{city}} {{nope}}", { city: null });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.missing).toEqual(["first_name", "city"]);
    expect(r.unknown).toEqual(["nope"]);
  });

  it("trims the substituted value", () => {
    const r = render("{{company}}", { company: "  Acme  " });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("Acme");
  });

  it("reports which variables were actually used", () => {
    const r = render("Hi {{first_name}} at {{company}}", VALUES);
    expect(r.used).toEqual(["first_name", "company"]);
  });

  it("leaves a template with no variables alone", () => {
    const r = render("No variables here.", {});
    expect(r).toEqual({ ok: true, text: "No variables here.", used: [] });
  });

  it("every declared variable has a value in the example set", () => {
    // Keeps the catalogue and the resolver from drifting apart.
    for (const v of TEMPLATE_VARIABLES) {
      expect(render(`{{${v.key}}}`, VALUES).ok).toBe(true);
    }
  });
});

describe("variablesIn", () => {
  it("separates known from unknown", () => {
    expect(variablesIn("{{company}} {{wat}}")).toEqual({ known: ["company"], unknown: ["wat"] });
  });

  it("deduplicates", () => {
    expect(variablesIn("{{company}} {{company}}").known).toEqual(["company"]);
  });
});

describe("reviewCopy", () => {
  const good =
    "Hi {{first_name}}, I saw {{company}} is hiring a Salesforce administrator. " +
    "We handle implementations for manufacturers in {{city}} and usually shorten the rollout " +
    "by a few weeks. Worth a short call on Thursday to see if it applies to you?";

  it("passes copy that is personalised, asks something and is a sane length", () => {
    expect(reviewCopy("Quick question about your Salesforce rollout", good)).toEqual([]);
  });

  it("flags an empty subject", () => {
    expect(reviewCopy("", good).map((w) => w.code)).toContain("no_subject");
  });

  it("flags a subject that will be truncated", () => {
    const codes = reviewCopy("A".repeat(70), good).map((w) => w.code);
    expect(codes).toContain("subject_long");
  });

  it("flags a body with no question in it", () => {
    const codes = reviewCopy("Hi", "Hi {{first_name}}, we do Salesforce work for {{company}}.").map(
      (w) => w.code
    );
    expect(codes).toContain("no_ask");
  });

  it("flags copy with no personalisation at all", () => {
    const codes = reviewCopy("Hello", "Can we talk about your CRM sometime this week?").map(
      (w) => w.code
    );
    expect(codes).toContain("no_personalisation");
  });

  it("flags known spam phrasing", () => {
    const codes = reviewCopy("Act now", good).map((w) => w.code);
    expect(codes).toContain("spam_phrase");
  });

  it("flags a shouted subject", () => {
    expect(reviewCopy("URGENT SALESFORCE HELP", good).map((w) => w.code)).toContain("shouting");
  });

  it("never blocks — it only describes", () => {
    // Every warning is advisory, so the return type carries no "blocked" flag.
    const warnings = reviewCopy("", "");
    expect(Array.isArray(warnings)).toBe(true);
  });
});

// A Wednesday at 11:30 IST.
const WED_1130_IST = new Date("2026-09-23T06:00:00.000Z");

function context(over: Partial<SendContext> = {}): SendContext {
  return {
    providerConfigured: true,
    toAddress: "priya@example.com",
    suppression: null,
    leadRepliedAt: null,
    sequence: {
      isActive: true,
      stopOnReply: true,
      stopOnUnsubscribe: true,
      sendWindowStart: 9,
      sendWindowEnd: 19,
      sendDays: [1, 2, 3, 4, 5],
      timezone: "Asia/Kolkata",
      dailyCap: 50,
    },
    enrollmentState: "active",
    sentToday: 0,
    unresolvedVariables: [],
    recentDuplicate: false,
    now: WED_1130_IST,
    ...over,
  };
}

describe("localParts", () => {
  it("reads the weekday and hour in the target timezone", () => {
    expect(localParts(WED_1130_IST, "Asia/Kolkata")).toMatchObject({ weekday: 3, hour: 11 });
  });

  it("gives a different local day where the date has already rolled over", () => {
    // 19:00 UTC Wednesday is already Thursday in Kolkata.
    const p = localParts(new Date("2026-09-23T19:00:00.000Z"), "Asia/Kolkata");
    expect(p.weekday).toBe(4);
  });

  it("reports midnight as hour 0, not 24", () => {
    const p = localParts(new Date("2026-09-23T18:30:00.000Z"), "Asia/Kolkata");
    expect(p.hour).toBe(0);
  });
});

describe("checkSendable", () => {
  it("allows a clean send inside the window", () => {
    expect(checkSendable(context())).toEqual({ sendable: true, blockers: [] });
  });

  it("blocks with no provider", () => {
    const { sendable, blockers } = checkSendable(context({ providerConfigured: false }));
    expect(sendable).toBe(false);
    expect(blockers[0].code).toBe("no_provider");
  });

  it("blocks with no address", () => {
    const codes = checkSendable(context({ toAddress: null })).blockers.map((b) => b.code);
    expect(codes).toContain("no_address");
  });

  it("blocks a suppressed address and says why and from where", () => {
    const { blockers } = checkSendable(
      context({ suppression: { reason: "Asked not to be contacted", source: "reply" } })
    );
    const b = blockers.find((x) => x.code === "suppressed");
    expect(b?.message).toContain("Asked not to be contacted");
    expect(b?.message).toContain("reply");
  });

  it("distinguishes an unsubscribe from other suppression", () => {
    const codes = checkSendable(
      context({ suppression: { reason: "Unsubscribed via link", source: "footer" } })
    ).blockers.map((b) => b.code);
    expect(codes).toContain("unsubscribed");
  });

  it("blocks once the lead has replied", () => {
    const codes = checkSendable(context({ leadRepliedAt: new Date() })).blockers.map((b) => b.code);
    expect(codes).toContain("already_replied");
  });

  it("does not block on a reply when the sequence opted out of that rule", () => {
    const codes = checkSendable(
      context({
        leadRepliedAt: new Date(),
        sequence: { ...context().sequence, stopOnReply: false },
      })
    ).blockers.map((b) => b.code);
    expect(codes).not.toContain("already_replied");
  });

  it("blocks a paused sequence and a stopped enrollment separately", () => {
    expect(
      checkSendable(context({ sequence: { ...context().sequence, isActive: false } })).blockers.map(
        (b) => b.code
      )
    ).toContain("sequence_paused");
    expect(
      checkSendable(context({ enrollmentState: "paused" })).blockers.map((b) => b.code)
    ).toContain("enrollment_stopped");
  });

  it("blocks an unresolved variable and names it", () => {
    const { blockers } = checkSendable(context({ unresolvedVariables: ["first_name"] }));
    const b = blockers.find((x) => x.code === "unresolved_variables");
    expect(b?.message).toContain("{{first_name}}");
  });

  it("blocks a repeat of the same step to the same address", () => {
    expect(
      checkSendable(context({ recentDuplicate: true })).blockers.map((b) => b.code)
    ).toContain("duplicate_recent_send");
  });

  it("blocks outside the send window", () => {
    // 04:00 IST.
    const early = new Date("2026-09-22T22:30:00.000Z");
    const { blockers } = checkSendable(context({ now: early }));
    const b = blockers.find((x) => x.code === "outside_send_window");
    expect(b?.waitsForClock).toBe(true);
    expect(b?.message).toContain("09:00");
  });

  it("blocks on a non-sending day", () => {
    // Sunday.
    const sunday = new Date("2026-09-27T06:00:00.000Z");
    const b = checkSendable(context({ now: sunday })).blockers.find(
      (x) => x.code === "outside_send_days"
    );
    expect(b?.message).toContain("Sunday");
    expect(b?.waitsForClock).toBe(true);
  });

  it("blocks at the daily cap", () => {
    const b = checkSendable(context({ sentToday: 50 })).blockers.find(
      (x) => x.code === "daily_cap_reached"
    );
    expect(b?.waitsForClock).toBe(true);
  });

  it("separates blockers time will clear from those needing a decision", () => {
    const { blockers } = checkSendable(
      context({ now: new Date("2026-09-27T06:00:00.000Z"), toAddress: null })
    );
    const actionable = actionableBlockers(blockers);
    expect(actionable.map((b) => b.code)).toEqual(["no_address"]);
  });

  it("reports consent blockers ahead of timing ones", () => {
    const { blockers } = checkSendable(
      context({
        suppression: { reason: "Unsubscribed", source: "footer" },
        now: new Date("2026-09-27T06:00:00.000Z"),
      })
    );
    // Consent is the reason to tell the user about, not the calendar.
    expect(blockers[0].code).toBe("unsubscribed");
  });
});

describe("nextSendWindow", () => {
  const seq = context().sequence;

  it("moves an early-morning send to the start of the window", () => {
    const at = nextSendWindow(new Date("2026-09-22T22:30:00.000Z"), seq);
    expect(localParts(at, seq.timezone).hour).toBe(9);
  });

  it("skips the weekend", () => {
    // Saturday 11:00 IST.
    const at = nextSendWindow(new Date("2026-09-26T05:30:00.000Z"), seq);
    expect(localParts(at, seq.timezone).weekday).toBe(1);
  });

  it("lands inside the window it returns", () => {
    for (const iso of [
      "2026-09-22T22:30:00.000Z",
      "2026-09-23T16:00:00.000Z",
      "2026-09-26T05:30:00.000Z",
      "2026-09-27T20:00:00.000Z",
    ]) {
      const at = nextSendWindow(new Date(iso), seq);
      const { weekday, hour } = localParts(at, seq.timezone);
      expect(seq.sendDays).toContain(weekday);
      expect(hour).toBeGreaterThanOrEqual(seq.sendWindowStart);
      expect(hour).toBeLessThan(seq.sendWindowEnd);
    }
  });

  it("does not loop forever when no day is selected", () => {
    const at = nextSendWindow(WED_1130_IST, { ...seq, sendDays: [] });
    expect(at.getTime()).toBeGreaterThan(WED_1130_IST.getTime());
  });

  it("returns a time that is always in the future", () => {
    const at = nextSendWindow(WED_1130_IST, seq);
    expect(at.getTime()).toBeGreaterThan(WED_1130_IST.getTime());
  });
});

describe("email provider", () => {
  /**
   * States the absence explicitly. Relying on the developer's `.env` having no
   * key means the test asserts the opposite of what it means the moment
   * someone adds one — which is exactly what happened with the AI key.
   */
  function withoutEmail() {
    for (const key of [
      "EMAIL_PROVIDER",
      "SMTP_URL",
      "RESEND_API_KEY",
      "AWS_SES_ACCESS_KEY_ID",
      "POSTMARK_SERVER_TOKEN",
      "GOOGLE_OAUTH_CLIENT_ID",
      "MICROSOFT_OAUTH_CLIENT_ID",
    ]) {
      vi.stubEnv(key, "");
    }
  }

  afterEach(() => vi.unstubAllEnvs());

  it("reports nothing configured when no credential is present", () => {
    withoutEmail();
    expect(isEmailConfigured()).toBe(false);
    expect(activeEmailProvider()).toBeNull();
    expect(canReceiveReplies()).toBe(false);
  });

  it("says what each provider needs and whether it can read replies", () => {
    for (const p of Object.values(EMAIL_PROVIDERS)) {
      expect(p.requires.length).toBeGreaterThan(10);
      expect(p.suits.length).toBeGreaterThan(10);
      expect(typeof p.canReceive).toBe("boolean");
    }
  });

  it("knows that send-only providers cannot honour stop-on-reply", () => {
    // The distinction exists precisely to gate enrollment.
    expect(EMAIL_PROVIDERS.resend.canReceive).toBe(false);
    expect(EMAIL_PROVIDERS.gmail.canReceive).toBe(true);
  });
});
