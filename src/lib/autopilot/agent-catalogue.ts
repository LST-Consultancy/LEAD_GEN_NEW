/**
 * The agents this app knows how to run, as definitions a workspace can be set
 * up from. Pure data, shared by the seed and by `provisionAgents`, so a real
 * workspace gets exactly what the demo shows — and starts with every agent off.
 *
 * Tools are names from `lib/ai/tools.ts`; some are declared and not built, and
 * `toolHealth()` says so on the agent's card rather than here.
 */
export const AGENT_CATALOGUE = [
  { kind: "PROSPECTING", name: "Prospecting agent", goal: "Find leads matching the primary ICP with a signal under 14 days old.", tools: ["find_leads", "search_leads", "add_lead"], points: 10, cap: 25 },
  { kind: "RESEARCH", name: "Research agent", goal: "Build account dossiers for Tier A leads before first contact.", tools: ["get_account", "research_company", "add_note"], points: 12, cap: 6 },
  { kind: "SDR", name: "SDR agent", goal: "Draft first-touch outreach grounded in the actual signal and knowledge base.", tools: ["draft_outreach", "enroll_sequence"], points: 0, cap: 20 },
  { kind: "FOLLOW_UP", name: "Follow-up agent", goal: "Keep pending conversations moving without nagging.", tools: ["draft_outreach", "create_task"], points: 0, cap: 30 },
  { kind: "PIPELINE", name: "Pipeline agent", goal: "Detect stalled deals and missing next steps, and explain why each matters.", tools: ["get_pipeline", "update_deal", "create_task"], points: 0, cap: 50 },
  { kind: "PROPOSAL", name: "Proposal agent", goal: "Draft proposals from the deal, knowledge base and pricing guardrails.", tools: ["get_lead", "draft_proposal"], points: 0, cap: 5 },
  { kind: "MEETING", name: "Meeting agent", goal: "Prepare a call brief 30 minutes before every booked meeting.", tools: ["get_meetings", "get_lead", "get_account"], points: 0, cap: 10 },
  { kind: "REVENUE_ANALYST", name: "Revenue analyst", goal: "Explain pipeline movement and forecast changes with the numbers behind them.", tools: ["get_insights", "get_pipeline"], points: 0, cap: 5 },
] as const;
