/**
 * What has actually shipped, newest first.
 *
 * Hand-kept rather than generated from `lib/nav.ts`: a nav entry says a route
 * exists, which is not the same as a capability arriving. Every line here
 * names something a person can now do, and the `caveat` says what it still
 * cannot — an entry with no caveat means there is genuinely nothing withheld.
 */

export type ChangelogEntry = {
  title: string;
  area: string;
  body: string;
  caveat: string | null;
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    title: "Opportunities become leads with their evidence",
    area: "Discovery",
    body: "Add to CRM now asks who the lead is for, carries the opportunity's sources onto the lead as signals, scores it against your primary ICP straight away, and credits its source in Insights. Company links open a real account page.",
    caveat: "Without a primary ICP the lead is created but unscored, and says so. Deal readiness checks are not generated for new leads yet.",
  },
  {
    title: "Honest provider status everywhere",
    area: "Discovery",
    body: "Screens that used to say no discovery source was connected now report your actual providers per job — discovery, finding people, verifying email — including whether each has passed its last test.",
    caveat: "Search-phrase watching, standalone person lookup and external company research have no adapter yet, and those screens say so.",
  },
  {
    title: "Channel readiness for email, WhatsApp and LinkedIn",
    area: "Outreach",
    body: "Each channel now reports how many of your leads it could actually reach, counted from contact records rather than estimated, alongside exactly what connecting it would require.",
    caveat:
      "Email sends through SMTP or Resend once a mailbox is connected. WhatsApp and LinkedIn have no sending adapter, so those steps hold with their reasons.",
  },
  {
    title: "LinkedIn as an assisted workflow",
    area: "Outreach",
    body: "Prepare the context, open the profile in your own session, write the message yourself, record that it happened.",
    caveat:
      "Automated sending is not built and is not planned — there is no sanctioned API for it, and the account at risk would be yours.",
  },
  {
    title: "The Copilot shows how it answered",
    area: "AI",
    body: "A short, specific question is answered by a single tool with no model involved, and says so. An open-ended one reads every readable tool first and the model may only phrase what came back.",
    caveat:
      "Ask for a tool that isn't built, or one that writes, and it names the tool and stops rather than improvising.",
  },
  {
    title: "Research reads what you already know",
    area: "AI",
    body: "A dossier assembled from your own rows — company, people, signals, deals and your team's notes — with every line naming the record it came from.",
    caveat:
      "Deep external research needs a licensed data source and stays switched off until there is one. Nothing is generated from a model's recollection.",
  },
  {
    title: "Playbooks check whether they can run",
    area: "AI",
    body: "Every step is resolved against the tool registry, so a playbook says up front which step it would stop at. One that could do nothing cannot be activated at all.",
    caveat: null,
  },
  {
    title: "Knowledge Base",
    area: "AI",
    body: "What you actually sell, in your own words, with a coverage strip naming what is missing. This is what bounds the claims a generated draft may make.",
    caveat: "Retrieval-backed grounding arrives when drafting is wired to a model.",
  },
  {
    title: "AI spend, from real token counts",
    area: "AI",
    body: "Settings → AI Assistant reports which features actually reach a model, which are only routed in config, and what has been spent — priced from the tokens each call used.",
    caveat: "Costs are estimated from published list prices, not read from a billing API.",
  },
  {
    title: "Recycle bin with a visible purge date",
    area: "Admin",
    body: "Every deletion is indexed with the date its data is actually removed, and restore brings a lead, list, sequence, playbook or knowledge entry back.",
    caveat:
      "A restored playbook or search phrase comes back inactive, so nothing resumes spending or sending without a decision.",
  },
  {
    title: "Retention you can see the consequences of",
    area: "Admin",
    body: "Archive and purge windows are set in Data & Privacy, each stated in terms of what it destroys and when, with a warning before you shorten one.",
    caveat:
      "Self-serve export and erasure for a data subject are not built — answering those is still a manual job.",
  },
  {
    title: "Agents, approvals and guardrails",
    area: "AI",
    body: "Agents hold only tools the registry declares, each action is priced before it runs, and refusals and deferrals are recorded rather than silently dropped.",
    caveat: null,
  },
  {
    title: "Proposals with arithmetic that holds",
    area: "Proposals",
    body: "Money is computed in integer paise and each line rounded once, so the subtotal always equals the sum of the figures printed beside it. A mismatch is reported, never silently corrected.",
    caveat: "Payment collection and GST invoicing are not built.",
  },
  {
    title: "Scoped API keys and signed webhooks",
    area: "Platform",
    body: "A key resolves to an ordinary auth context, so every service enforces its scopes exactly as it does for a person. Webhook deliveries are signed and retried.",
    caveat: null,
  },
];
