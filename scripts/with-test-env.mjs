// `node scripts/with-test-env.mjs <command...>` runs a command against the test database and Redis db.
import { spawnSync } from "node:child_process";
import { testEnv } from "./test-env.mjs";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) { console.error("Usage: node scripts/with-test-env.mjs <command...>"); process.exit(2); }
const result = spawnSync(cmd, args, { stdio: "inherit", env: testEnv(), shell: false });
process.exit(result.status ?? 1);
