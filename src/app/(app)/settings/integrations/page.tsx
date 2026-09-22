import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { CrmView } from "@/components/integrations/crm-view";

export const metadata: Metadata = { title: "CRM Integrations" };

/**
 * Declared here rather than in the database: nothing is connectable yet, so
 * there is no connection state to store. When one is built it moves to a
 * provider module like the email and calendar ones.
 */
const PROVIDERS = [
  {
    name: "salesforce",
    label: "Salesforce",
    connected: false,
    direction: "two-way",
    syncs: "Accounts, contacts, opportunities and activity, mapped to companies, people, deals and the timeline.",
    requires: "A connected app with OAuth, and a decision about which system owns each field.",
  },
  {
    name: "hubspot",
    label: "HubSpot",
    connected: false,
    direction: "two-way",
    syncs: "Companies, contacts and deals, plus engagement history.",
    requires: "A private app token with CRM read and write scopes.",
  },
  {
    name: "zoho",
    label: "Zoho CRM",
    connected: false,
    direction: "two-way",
    syncs: "Accounts, leads and deals — the common system of record for Indian mid-market.",
    requires: "OAuth with the ZohoCRM.modules scope, and a data-centre region.",
  },
  {
    name: "pipedrive",
    label: "Pipedrive",
    connected: false,
    direction: "two-way",
    syncs: "Organisations, persons and deals.",
    requires: "An API token and a pipeline mapping.",
  },
  {
    name: "sheets",
    label: "Google Sheets",
    connected: false,
    direction: "export only",
    syncs: "A scheduled export of leads or pipeline to a sheet, for teams that run on one.",
    requires: "OAuth for the Sheets API and a target spreadsheet.",
  },
];

export default async function CrmPage() {
  await requireAuth();
  return <CrmView providers={PROVIDERS} />;
}
