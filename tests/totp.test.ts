import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateSecret,
  hotp,
  normaliseRecoveryCode,
  provisioningUri,
  stepFor,
  verifyTotp,
} from "@/lib/auth/totp";

/**
 * RFC 6238, Appendix B. The seed is the ASCII string "12345678901234567890"
 * and the vectors are 8 digits. If this implementation disagrees with these,
 * it disagrees with every authenticator app, so this is the test that matters.
 */
const RFC_SEED = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: [seconds: number, code: string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("RFC 6238 test vectors", () => {
  it.each(RFC_VECTORS)("matches the published code at t=%i", (seconds, expected) => {
    const step = Math.floor(seconds / 30);
    expect(hotp(RFC_SEED, step, 8)).toBe(expected);
  });

  it("produces a code past the 32-bit counter boundary", () => {
    // t=20000000000 is step 666666666, which still fits — but the writer splits
    // the counter into two 32-bit halves and this proves the high half is used.
    expect(hotp(RFC_SEED, 0x1_0000_0001, 8)).toHaveLength(8);
  });
});

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    for (const len of [1, 2, 3, 4, 5, 10, 20, 32]) {
      const buf = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37) % 256));
      expect(base32Decode(base32Encode(buf))).toEqual(buf);
    }
  });

  it("matches the RFC 4648 example", () => {
    expect(base32Encode(Buffer.from("foobar", "ascii"))).toBe("MZXW6YTBOI");
  });

  it("tolerates padding, whitespace and lower case in what a user pastes", () => {
    const secret = base32Encode(Buffer.from("foobar", "ascii"));
    expect(base32Decode("mzxw6ytboi")).toEqual(base32Decode(secret));
    expect(base32Decode("MZXW 6YTB OI==")).toEqual(base32Decode(secret));
  });

  it("refuses characters that are not base32", () => {
    // 0, 1 and 8 are excluded from the alphabet precisely because they are
    // confusable; accepting them silently would decode to the wrong secret.
    expect(() => base32Decode("MZXW6YTB01")).toThrow();
  });
});

describe("generateSecret", () => {
  it("is 20 bytes, which is what authenticator apps are tested against", () => {
    expect(base32Decode(generateSecret())).toHaveLength(20);
  });

  it("differs every time", () => {
    const seen = new Set(Array.from({ length: 50 }, generateSecret));
    expect(seen.size).toBe(50);
  });
});

describe("verifyTotp", () => {
  const secret = base32Encode(RFC_SEED);
  const at = (seconds: number) => seconds * 1000;

  it("accepts the code for the current step", () => {
    const step = stepFor(at(1111111111));
    const code = hotp(RFC_SEED, step);
    expect(verifyTotp({ secret, code, atMs: at(1111111111) })).toMatchObject({ ok: true, step });
  });

  it("accepts one step either side, for clock skew", () => {
    const now = at(1111111111);
    const current = stepFor(now);
    for (const offset of [-1, 0, 1]) {
      expect(verifyTotp({ secret, code: hotp(RFC_SEED, current + offset), atMs: now })).toMatchObject(
        { ok: true }
      );
    }
  });

  it("refuses two steps away", () => {
    const now = at(1111111111);
    const verdict = verifyTotp({ secret, code: hotp(RFC_SEED, stepFor(now) + 2), atMs: now });
    expect(verdict).toMatchObject({ ok: false, reason: "mismatch" });
  });

  it("refuses a code that was already used", () => {
    const now = at(1111111111);
    const step = stepFor(now);
    // This is what stops a code read over someone's shoulder working for the
    // rest of its 30-second window.
    expect(
      verifyTotp({ secret, code: hotp(RFC_SEED, step), atMs: now, lastUsedStep: step })
    ).toMatchObject({ ok: false, reason: "replayed" });
  });

  it("refuses a code from before the last one used", () => {
    const now = at(1111111111);
    const step = stepFor(now);
    expect(
      verifyTotp({ secret, code: hotp(RFC_SEED, step - 1), atMs: now, lastUsedStep: step })
    ).toMatchObject({ ok: false, reason: "replayed" });
  });

  it("accepts the next step after one is consumed", () => {
    const now = at(1111111111);
    const step = stepFor(now);
    expect(
      verifyTotp({
        secret,
        code: hotp(RFC_SEED, step + 1),
        atMs: now,
        lastUsedStep: step,
      })
    ).toMatchObject({ ok: true, step: step + 1 });
  });

  it("rejects anything that is not six digits", () => {
    for (const code of ["", "12345", "1234567", "abcdef", "12 34 5", "  "]) {
      expect(verifyTotp({ secret, code, atMs: at(1111111111) })).toMatchObject({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("ignores spaces a user types between groups", () => {
    const now = at(1111111111);
    const code = hotp(RFC_SEED, stepFor(now));
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp({ secret, code: spaced, atMs: now })).toMatchObject({ ok: true });
  });

  it("rejects a malformed secret rather than throwing", () => {
    expect(verifyTotp({ secret: "not!base32", code: "123456" })).toMatchObject({
      ok: false,
      reason: "malformed",
    });
  });
});

describe("provisioningUri", () => {
  it("carries the secret, issuer and parameters an app needs", () => {
    const uri = provisioningUri({
      secret: "ABCDEFGHIJKLMNOP",
      accountName: "rahul@northbridge.example",
      issuer: "Signalroom",
    });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    const parsed = new URL(uri);
    expect(parsed.searchParams.get("secret")).toBe("ABCDEFGHIJKLMNOP");
    expect(parsed.searchParams.get("issuer")).toBe("Signalroom");
    expect(parsed.searchParams.get("digits")).toBe("6");
    expect(parsed.searchParams.get("period")).toBe("30");
    // The issuer is in the label too, for apps that only read the label.
    expect(decodeURIComponent(parsed.pathname)).toContain("Signalroom:rahul@northbridge.example");
  });
});

describe("recovery codes", () => {
  it("generates the requested number, all distinct", () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("is readable aloud and typed back in any case", () => {
    const [code] = generateRecoveryCodes(1);
    expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(normaliseRecoveryCode(code.toLowerCase())).toBe(normaliseRecoveryCode(code));
    expect(normaliseRecoveryCode(code.replace("-", " "))).toBe(normaliseRecoveryCode(code));
  });
});
