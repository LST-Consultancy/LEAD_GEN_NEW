/**
 * Bounded live smoke test for the enrichment fallback providers, run by an operator — never by CI.
 *
 *   npm run smoke:providers -- --workspace <slug>                  free checks only (default)
 *   npm run smoke:providers -- --workspace <slug> --paid --max 3 \
 *       --domain <a domain you own or have permission to test> --first <name> --last <name>
 *
 * Free mode calls only each provider's documented no-cost account endpoint (Hunter /account,
 * SignalHire /credits, Apollo /auth/health) and Hunter's free Domain Finder, and reports whether
 * each adapter's response still parses. Paid mode additionally makes at most `--max` credit-spending
 * calls (default 0, hard ceiling 5), each printed before it is made. A token check is reported as a
 * token check, never as an integration test. Credentials are decrypted in-process and never printed.
 * Nothing is written except the provider request log rows every call writes.
 */
import { db } from "@/lib/db";
import { decryptCredential } from "@/lib/providers/credentials";
import { hunterCalls } from "@/lib/providers/hunter-extra";
import { hunterProvider } from "@/lib/providers/hunter";
import { apolloProvider } from "@/lib/providers/apollo";
import { signalHireProvider } from "@/lib/providers/signalhire";
import { ProviderRequestError } from "@/lib/providers/provider-errors";
import { classifyProviderError } from "@/lib/enrichment/provider-outcome";
import { ZodError } from "zod";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] ?? "" : null; };
const flag = (name: string) => process.argv.includes(`--${name}`);

type Row = { provider: string; check: string; kind: "token check" | "free call" | "paid call"; result: string };
async function main() {
  const slug = arg("workspace");
  if (!slug) throw new Error("Pass --workspace <slug>.");
  const paid = flag("paid"); const max = Math.min(5, Math.max(0, Number(arg("max") ?? 0) || 0));
  const workspace = await db.workspace.findFirst({ where: { slug }, select: { id: true } });
  if (!workspace) throw new Error(`No workspace with slug ${slug}.`);
  const rows: Row[] = []; let spent = 0;
  const conn = async (provider: string) => { const r = await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: workspace.id, provider } } }); return r?.enabled && r.encryptedCredentials ? decryptCredential(r.encryptedCredentials, workspace.id, provider) : null; };
  const run = async (provider: "hunter" | "apollo" | "signalhire", check: string, kind: Row["kind"], fn: () => Promise<string>) => {
    if (kind === "paid call") { if (!paid || spent >= max) { rows.push({ provider, check, kind, result: "not run (no paid authorisation or cap reached)" }); return; } spent++; console.log(`→ paid call ${spent}/${max}: ${provider} ${check}`); }
    try { rows.push({ provider, check, kind, result: await fn() }); }
    catch (e) { rows.push({ provider, check, kind, result: e instanceof ZodError ? `SCHEMA CHANGED at ${e.issues[0]?.path.join(".") || "root"}` : e instanceof ProviderRequestError ? `${classifyProviderError(provider, e).outcome} (HTTP ${e.status ?? "—"}${e.providerCode ? `, ${e.providerCode}` : ""})` : "failed (network or unexpected)" }); }
  };
  const hk = await conn("hunter");
  if (hk) {
    await run("hunter", "GET /account", "token check", async () => (await hunterProvider(workspace.id, hk).healthCheck()).ok ? "key accepted" : "key refused");
    await run("hunter", "Domain Finder (free)", "free call", async () => `${(await hunterCalls(workspace.id, hk).domainFinder("Hunter")).length} result(s), shape parsed`);
    const domain = arg("domain"), first = arg("first"), last = arg("last");
    if (domain) {
      await run("hunter", `Company Enrichment ${domain}`, "paid call", async () => { const d = await hunterCalls(workspace.id, hk).companyFind(domain); return `parsed; name ${d.name ? "present" : "absent"}`; });
      if (first && last) await run("hunter", "Email Finder", "paid call", async () => { const d = await hunterCalls(workspace.id, hk).emailFinder(domain, first, last); return d.email ? `address returned (score ${d.score ?? "—"})` : "no address"; });
    }
  } else rows.push({ provider: "hunter", check: "—", kind: "token check", result: "not connected in this workspace" });
  const sk = await conn("signalhire");
  if (sk) {
    await run("signalhire", "GET /credits", "token check", async () => (await signalHireProvider(workspace.id, sk).healthCheck()).message.replace(/\d+/, "<n>"));
    await run("signalhire", "Search by query (search quota, no credits)", "free call", async () => `${(await signalHireProvider(workspace.id, sk).searchPeople("SignalHire", ["CEO"], 1)).length} profile(s), shape parsed`);
  } else rows.push({ provider: "signalhire", check: "—", kind: "token check", result: "not connected in this workspace" });
  const ak = await conn("apollo");
  if (ak) {
    await run("apollo", "GET /auth/health", "token check", async () => (await apolloProvider(workspace.id, ak).healthCheck()).ok ? "key accepted" : "key refused");
    await run("apollo", "People API Search (0 credits)", "free call", async () => `${(await apolloProvider(workspace.id, ak).peopleSearch("apollo.io", ["CEO"], 1)).length} result(s), shape parsed`);
  } else rows.push({ provider: "apollo", check: "—", kind: "token check", result: "not connected in this workspace" });
  console.table(rows);
  console.log(`Paid calls made: ${spent} (cap ${paid ? max : 0}). A token check proves only that the key is accepted.`);
  await db.$disconnect();
}
main().catch(async e => { console.error(e instanceof Error ? e.message : "Smoke test failed."); await db.$disconnect(); process.exit(1); });
