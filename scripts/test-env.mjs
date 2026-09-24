// The one definition of "the test environment", shared by Vitest, Playwright
// and the db:test:* scripts so they can never disagree about which database is safe.
import "dotenv/config";

const DB_NAME = /\/([^/?]+)(\?|$)/;

export function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? "";
  return base.replace(DB_NAME, (_m, name, tail) => `/${name.endsWith("_test") ? name : `${name.replace(/_dev$/, "")}_test`}${tail}`);
}

// Redis logical database 15 keeps test jobs out of the queue the live worker consumes.
export function testRedisUrl() {
  if (process.env.TEST_REDIS_URL) return process.env.TEST_REDIS_URL;
  return process.env.REDIS_URL ? process.env.REDIS_URL.replace(/(redis:\/\/[^/]+)(\/\d+)?$/, "$1/15") : "";
}

export function assertSafeTestDatabase(url) {
  const name = url.match(DB_NAME)?.[1] ?? "";
  if (!/localhost|127\.0\.0\.1/.test(url) || !name.endsWith("_test")) {
    throw new Error(`Refusing: the test database must be local and named *_test, got "${name}".`);
  }
}

export function testEnv() {
  const DATABASE_URL = testDatabaseUrl();
  assertSafeTestDatabase(DATABASE_URL);
  return { ...process.env, DATABASE_URL, REDIS_URL: testRedisUrl(), SEED_ERASES_REAL_DATA: "" };
}
