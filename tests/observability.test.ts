import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLine,
  createLogger,
  formatHuman,
  isSecretKey,
  redact,
  isJsonFormat,
} from "@/lib/observability/log";
import { REQUEST_ID_HEADER, isWellFormed, resolveRequestId } from "@/lib/observability/request-id";

afterEach(() => vi.unstubAllEnvs());

describe("redact", () => {
  it("removes anything whose key looks like a secret", () => {
    const out = redact({
      email: "a@b.test",
      password: "hunter2",
      apiKey: "sr_live_abc",
      ANTHROPIC_API_KEY: "sk-ant-xyz",
      mfaSecret: "JBSWY3DP",
      authorization: "Bearer abc",
      cookie: "sr_session=abc",
      plaintext: "sr_live_def",
    }) as Record<string, unknown>;

    expect(out.email).toBe("a@b.test");
    for (const key of [
      "password",
      "apiKey",
      "ANTHROPIC_API_KEY",
      "mfaSecret",
      "authorization",
      "cookie",
      "plaintext",
    ]) {
      expect(out[key], key).toBe("[redacted]");
    }
  });

  it("redacts nested values too", () => {
    const out = redact({ user: { name: "Rahul", passwordHash: "$2a$12$..." } }) as {
      user: Record<string, unknown>;
    };
    expect(out.user.name).toBe("Rahul");
    expect(out.user.passwordHash).toBe("[redacted]");
  });

  it("keeps an error readable instead of serialising it to {}", () => {
    const out = redact(new Error("boom")) as Record<string, unknown>;
    // `JSON.stringify(new Error())` is "{}", which is the single most useless
    // thing a log can contain.
    expect(out.message).toBe("boom");
    expect(out.name).toBe("Error");
  });

  it("does not hang on a cycle", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => JSON.stringify(redact(a))).not.toThrow();
  });

  it("bounds a very large array rather than logging all of it", () => {
    const out = redact(Array.from({ length: 500 }, (_, i) => i)) as unknown[];
    expect(out.length).toBeLessThanOrEqual(50);
  });

  it("passes primitives through untouched", () => {
    expect(redact(42)).toBe(42);
    expect(redact("plain")).toBe("plain");
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });
});

describe("isSecretKey", () => {
  it("matches regardless of case, dashes and underscores", () => {
    for (const key of ["API_KEY", "api-key", "apiKey", "x-api-key", "Authorization"]) {
      expect(isSecretKey(key), key).toBe(true);
    }
  });

  it("does not match ordinary fields", () => {
    for (const key of ["email", "workspaceId", "leadId", "count", "durationMs"]) {
      expect(isSecretKey(key), key).toBe(false);
    }
  });
});

describe("buildLine", () => {
  it("carries level, scope, message and a timestamp", () => {
    const line = buildLine("warn", "api", "something", { requestId: "abc" });
    expect(line).toMatchObject({ level: "warn", scope: "api", msg: "something", requestId: "abc" });
    expect(() => new Date(line.at).toISOString()).not.toThrow();
  });

  it("redacts fields on the way in, not at the call site", () => {
    const line = buildLine("error", "api", "failed", { token: "sr_live_abc" });
    expect(line.token).toBe("[redacted]");
  });
});

describe("formatHuman", () => {
  it("leads with the scope and shortens the request id", () => {
    const text = formatHuman(buildLine("error", "queue", "enqueue failed", {
      requestId: "0123456789abcdef",
      job: "rescore",
    }));
    expect(text).toContain("[queue]");
    expect(text).toContain("01234567");
    expect(text).toContain("ERROR");
    expect(text).toContain("enqueue failed");
    expect(text).toContain("rescore");
  });
});

describe("isJsonFormat", () => {
  it("is JSON in production and readable otherwise", () => {
    vi.stubEnv("LOG_FORMAT", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(isJsonFormat()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(isJsonFormat()).toBe(false);
  });

  it("lets LOG_FORMAT override either way", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_FORMAT", "json");
    expect(isJsonFormat()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_FORMAT", "human");
    expect(isJsonFormat()).toBe(false);
  });
});

describe("createLogger", () => {
  it("drops debug in production and keeps it otherwise", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      vi.stubEnv("NODE_ENV", "production");
      createLogger("api").debug("noisy");
      expect(spy).not.toHaveBeenCalled();

      vi.stubEnv("NODE_ENV", "development");
      createLogger("api").debug("noisy");
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("sends warnings and errors to stderr", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      createLogger("api").error("broke");
      expect(err).toHaveBeenCalled();
      expect(out).not.toHaveBeenCalled();
    } finally {
      err.mockRestore();
      out.mockRestore();
    }
  });

  it("child() carries bound fields onto every later line", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.stubEnv("LOG_FORMAT", "json");
      createLogger("api").child({ requestId: "req-1" }).error("failed", { route: "/api/leads" });
      const line = JSON.parse(err.mock.calls[0][0] as string);
      expect(line.requestId).toBe("req-1");
      expect(line.route).toBe("/api/leads");
    } finally {
      err.mockRestore();
    }
  });
});

describe("resolveRequestId", () => {
  it("mints one when there is nothing to reuse", () => {
    expect(isWellFormed(resolveRequestId(null))).toBe(true);
  });

  it("honours a well-formed inbound id, so hops correlate", () => {
    expect(resolveRequestId("abc-123_DEF456")).toBe("abc-123_DEF456");
  });

  it("refuses an id that could forge a log line or inject a header", () => {
    // The value is echoed into a response header and into log lines, so a
    // newline in it would let a caller write fake entries.
    for (const bad of [
      "short",
      "has space",
      "line\nbreak",
      "carriage\rreturn",
      "semi;colon",
      "x".repeat(65),
      "",
    ]) {
      const resolved = resolveRequestId(bad);
      expect(resolved, bad).not.toBe(bad);
      expect(isWellFormed(resolved)).toBe(true);
    }
  });

  it("names the header once, so nothing spells it differently", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });
});
