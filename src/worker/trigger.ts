/**
 * Manually enqueue a job.
 *
 *   npm run job -- --list
 *   npm run job -- rescore.workspace
 *   npm run job -- pipeline.detect_risks --workspace <uuid>
 *   npm run job -- --all
 *
 * Exists because "wait for the nightly run" is not a workable answer when you
 * need to see the effect of a change now, and because an operator debugging a
 * stale score should not have to write a script to force a recompute.
 */

import "dotenv/config";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue/producer";
import { isQueueConfigured } from "@/lib/queue/connection";
import { JOB, JOB_LABEL, JOB_SCHEDULE, type JobName } from "@/lib/queue/jobs";

const SAFE_TO_TRIGGER: JobName[] = [
  JOB.RESCORE_WORKSPACE,
  JOB.DETECT_DEAL_RISKS,
  JOB.RESCORE_WORKLIST,
  JOB.REFRESH_NEXT_ACTIONS,
  JOB.ARCHIVE_STALE_LEADS,
  JOB.PURGE_RECYCLE_BIN,
  JOB.SWEEP_NOTIFICATIONS,
  JOB.GENERATE_COACH_TIPS,
];

function usage() {
  console.log("\nUsage: npm run job -- <job-name> [--workspace <uuid>]\n");
  console.log("Jobs that can be triggered by hand:\n");
  for (const name of SAFE_TO_TRIGGER) {
    const schedule = JOB_SCHEDULE[name];
    console.log(`  ${name.padEnd(30)} ${JOB_LABEL[name]}`);
    if (schedule) console.log(`  ${"".padEnd(30)} ${schedule.describe}`);
  }
  console.log("\nFlags:");
  console.log("  --list              Show this list");
  console.log("  --all               Enqueue every job above");
  console.log("  --workspace <uuid>  Target one workspace (default: all)\n");
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes("--list") || argv.includes("--help")) {
    usage();
    return;
  }

  if (!isQueueConfigured()) {
    console.error(
      "\nREDIS_URL is not set, so there is no queue to enqueue onto.\n" +
        "Set it in .env and start the worker with `npm run worker`.\n"
    );
    process.exitCode = 1;
    return;
  }

  const wsFlag = argv.indexOf("--workspace");
  const targetWorkspace = wsFlag >= 0 ? argv[wsFlag + 1] : undefined;

  const workspaces = targetWorkspace
    ? await db.workspace.findMany({
        where: { id: targetWorkspace, deletedAt: null },
        select: { id: true, name: true },
      })
    : await db.workspace.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });

  if (workspaces.length === 0) {
    console.error(
      targetWorkspace
        ? `\nNo workspace with id ${targetWorkspace}.\n`
        : "\nNo workspaces exist yet. Run `npm run db:seed` first.\n"
    );
    process.exitCode = 1;
    return;
  }

  const requested = argv.includes("--all")
    ? SAFE_TO_TRIGGER
    : argv.filter((a) => SAFE_TO_TRIGGER.includes(a as JobName)).map((a) => a as JobName);

  if (requested.length === 0) {
    console.error(`\nUnrecognised job. Run \`npm run job -- --list\` to see what exists.\n`);
    process.exitCode = 1;
    return;
  }

  console.log("");
  for (const workspace of workspaces) {
    console.log(`  ${workspace.name}`);
    for (const name of requested) {
      // A timestamped key means a manual trigger is never deduped against the
      // scheduled run, which is the whole point of triggering it.
      const result = await enqueue(
        name,
        { workspaceId: workspace.id } as never,
        { dedupeKey: `manual:${name}:${workspace.id}:${Date.now()}` }
      );
      const status = result.queued
        ? `queued as ${result.jobId}`
        : `not queued — ${result.detail}`;
      console.log(`    ${name.padEnd(30)} ${status}`);
    }
  }
  console.log("\nWatch `npm run worker` for the outcome.\n");
}

main()
  .catch((err) => {
    console.error("Failed:", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    // The producer holds an open Redis connection; nothing further to do.
    process.exit(process.exitCode ?? 0);
  });
