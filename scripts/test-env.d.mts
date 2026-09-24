export function testDatabaseUrl(): string;
export function testRedisUrl(): string;
export function assertSafeTestDatabase(url: string): void;
export function testEnv(): NodeJS.ProcessEnv & { DATABASE_URL: string; REDIS_URL: string };
