// Tests write fixtures and enqueue jobs, and the working database holds real
// customer data, so they run against their own database and Redis db.
import { testEnv } from "../scripts/test-env.mjs";

const env = testEnv();
process.env.DATABASE_URL = env.DATABASE_URL;
if (env.REDIS_URL) process.env.REDIS_URL = env.REDIS_URL;
