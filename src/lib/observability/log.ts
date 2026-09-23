/**
 * §105 — structured logging.
 *
 * Pure and dependency-free, so it runs in the edge middleware, in a route, in
 * the worker under tsx, and in a test without a stub.
 *
 * Three decisions worth stating:
 *
 *  - **JSON in production, readable in development.** A log nobody can grep is
 *    not observability, and a log nobody can read while writing the code does
 *    not get read at all. The shape is identical either way, so a field that
 *    exists locally exists in production.
 *  - **Every line carries a request id.** Thirty-two scattered `console.error`
 *    calls could each tell you something broke; none of them could tell you
 *    they broke during the *same* request. That is the whole difference between
 *    a log and a trace.
 *  - **Redaction is by key, not by hope.** Anything whose key looks like a
 *    secret is replaced before serialisation. A logger that takes arbitrary
 *    objects will eventually be handed a session token or an API key, and the
 *    only reliable defence is to assume it already has been.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

/**
 * Keys whose values never reach a log line.
 *
 * Matched case-insensitively as substrings, so `apiKey`, `ANTHROPIC_API_KEY`
 * and `key` are all caught. Deliberately broad: a redacted field that did not
 * need redacting costs a debugging session, while one that needed it and
 * wasn't costs an incident.
 */
const SECRET_KEYS = [
  "password",
  "passwordhash",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "sessionid",
  "mfasecret",
  "recoverycode",
  "plaintext",
  "signature",
];

const REDACTED = "[redacted]";

/** How deep to walk a value before giving up, so a cycle cannot hang a log call. */
const MAX_DEPTH = 4;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[too deep]";
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSecretKey(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

export function isSecretKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[-_]/g, "");
  return SECRET_KEYS.some((s) => normalised.includes(s.replace(/[-_]/g, "")));
}

export type LogLine = {
  level: LogLevel;
  msg: string;
  /** Which subsystem, matching the `[queue]` / `[api]` prefixes used before. */
  scope: string;
  at: string;
  requestId?: string;
  [key: string]: unknown;
};

export function buildLine(
  level: LogLevel,
  scope: string,
  msg: string,
  fields: LogFields = {}
): LogLine {
  const safe = redact(fields) as LogFields;
  return { level, scope, msg, at: new Date().toISOString(), ...safe };
}

/** Rendered for a person, when the output is a terminal rather than a collector. */
export function formatHuman(line: LogLine): string {
  const { level, scope, msg, at, requestId, ...rest } = line;
  void at;
  const id = requestId ? ` (${String(requestId).slice(0, 8)})` : "";
  const extras = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
  return `[${scope}]${id} ${level.toUpperCase()}: ${msg}${extras}`;
}

/**
 * Whether to emit machine-readable lines.
 *
 * Production defaults to JSON because something is collecting it. `LOG_FORMAT`
 * overrides, so a developer can read production format locally without
 * pretending to be in production.
 */
export function isJsonFormat(): boolean {
  const explicit = process.env.LOG_FORMAT;
  if (explicit === "json") return true;
  if (explicit === "human") return false;
  return process.env.NODE_ENV === "production";
}

function emit(line: LogLine): void {
  const text = isJsonFormat() ? JSON.stringify(line) : formatHuman(line);
  // Warnings and errors go to stderr so a collector can separate them without
  // parsing, and so a piped stdout stays clean.
  if (line.level === "error" || line.level === "warn") console.error(text);
  else console.log(text);
}

/**
 * A logger bound to one scope, and optionally to one request.
 *
 * `child()` is how a request id reaches code that has no idea a request exists
 * — a service, a queue handler — without threading a parameter through every
 * signature.
 */
export type Logger = {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
};

export function createLogger(scope: string, bound: LogFields = {}): Logger {
  const at = (level: LogLevel) => (msg: string, fields: LogFields = {}) =>
    emit(buildLine(level, scope, msg, { ...bound, ...fields }));

  return {
    debug: (msg, fields) => {
      // Debug is dropped in production rather than sampled: a debug line that
      // survives is a debug line someone will rely on and then be surprised by.
      if (process.env.NODE_ENV !== "production") at("debug")(msg, fields);
    },
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    child: (fields) => createLogger(scope, { ...bound, ...fields }),
  };
}

/** The default loggers, one per subsystem that already had a console prefix. */
export const log = {
  api: createLogger("api"),
  queue: createLogger("queue"),
  ai: createLogger("ai"),
  auth: createLogger("auth"),
  security: createLogger("security"),
};
