/**
 * Turns a plain-language description of who you sell to into a structured ICP
 * draft.
 *
 * This is **pattern extraction, not comprehension**. It matches against
 * vocabularies of Indian geography, industries, roles and technologies, and
 * reads numeric ranges. It reports what it matched *and what it ignored*, so
 * the user can see the gaps rather than assuming the machine understood them.
 *
 * Deliberately deterministic and free of any model call: the output is a draft
 * a human confirms, and a draft you cannot audit is worse than a blank form.
 * When a provider is configured this becomes the first pass, not the only one.
 */

export type ExtractionField =
  | "industries"
  | "locations"
  | "employeeMin"
  | "employeeMax"
  | "buyerRoles"
  | "seniorities"
  | "technologies"
  | "sellsTechnologies"
  | "triggerEvents"
  | "exclusions";

export type Extraction = {
  draft: {
    sellsDescription: string;
    /** Technologies you sell or implement — not something the prospect runs. */
    sellsTechnologies: string[];
    industries: string[];
    locations: string[];
    employeeMin: number | null;
    employeeMax: number | null;
    buyerRoles: string[];
    seniorities: string[];
    technologies: string[];
    triggerEvents: string[];
    exclusions: string[];
  };
  /** Each match, with the phrase that produced it, so the user can check it. */
  matched: { field: ExtractionField; value: string; from: string }[];
  /** Fields the text said nothing about. */
  missing: ExtractionField[];
  /** Words left over after extraction — the honest "I didn't understand this". */
  unmatchedTerms: string[];
  /** Suggested phrases to watch, derived only from what was actually matched. */
  suggestedPhrases: { phrase: string; sourceKind: string; because: string }[];
};

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

const INDUSTRIES: Record<string, string[]> = {
  Manufacturing: ["manufactur", "factory", "factories", "plant", "industrial", "engineering goods", "auto component", "textile", "fmcg", "chemical", "pharma manufactur"],
  Logistics: ["logistic", "freight", "shipping", "warehous", "supply chain", "3pl", "cold chain", "transport"],
  "IT Services": ["it services", "it service", "software services", "systems integrator", "consultancy", "software development", "digital agency", "managed services"],
  SaaS: ["saas", "software product", "b2b software", "platform compan", "product compan"],
  Fintech: ["fintech", "lending", "payments", "nbfc", "insurtech"],
  "Financial Services": ["financial services", "insurance", "wealth", "broking", "banking", "mutual fund"],
  Healthcare: ["healthcare", "hospital", "clinic", "diagnostics", "pharma", "medical device"],
  "E-commerce": ["e-commerce", "ecommerce", "d2c", "direct to consumer", "online retail", "marketplace"],
  Retail: ["retail", "store chain", "fmcg distribution"],
  Education: ["edtech", "education", "school", "college", "university", "training"],
  Construction: ["construction", "infrastructure", "epc", "real estate", "builder"],
  Energy: ["energy", "solar", "renewable", "power", "oil and gas"],
  Hospitality: ["hospitality", "hotel", "resort", "restaurant", "travel", "tourism"],
  Distribution: ["distribut", "wholesale", "trading", "dealer", "stockist"],
  Agriculture: ["agri", "agritech", "farming", "food processing"],
};

const STATES = [
  "Maharashtra", "Karnataka", "Tamil Nadu", "Telangana", "Gujarat", "Delhi", "Haryana",
  "Uttar Pradesh", "West Bengal", "Rajasthan", "Kerala", "Punjab", "Madhya Pradesh",
  "Andhra Pradesh", "Bihar", "Odisha", "Assam", "Goa", "Jharkhand", "Chhattisgarh",
  "Uttarakhand", "Himachal Pradesh",
];

const CITIES = [
  "Mumbai", "Pune", "Bengaluru", "Bangalore", "Delhi", "Gurugram", "Gurgaon", "Noida",
  "Hyderabad", "Chennai", "Ahmedabad", "Surat", "Kolkata", "Jaipur", "Nashik", "Nagpur",
  "Indore", "Bhopal", "Coimbatore", "Kochi", "Cochin", "Chandigarh", "Lucknow", "Kanpur",
  "Vadodara", "Rajkot", "Visakhapatnam", "Vijayawada", "Madurai", "Mysuru", "Mysore",
  "Guwahati", "Panaji", "Ratnagiri", "Thane", "Faridabad", "Ludhiana", "Agra", "Varanasi",
];

/** Multi-region shorthands that expand to several places. */
const REGIONS: Record<string, string[]> = {
  india: ["India"],
  indian: ["India"],
  "pan-india": ["India"],
  "south india": ["Karnataka", "Tamil Nadu", "Telangana", "Kerala", "Andhra Pradesh"],
  "north india": ["Delhi", "Haryana", "Uttar Pradesh", "Punjab", "Rajasthan"],
  "west india": ["Maharashtra", "Gujarat", "Goa"],
  "western india": ["Maharashtra", "Gujarat", "Goa"],
  "east india": ["West Bengal", "Odisha", "Bihar", "Jharkhand"],
  "ncr": ["Delhi", "Gurugram", "Noida", "Faridabad"],
  "delhi ncr": ["Delhi", "Gurugram", "Noida", "Faridabad"],
  "mmr": ["Mumbai", "Thane"],
  "tier 2": ["Nashik", "Indore", "Coimbatore", "Jaipur", "Kochi", "Vadodara"],
};

const ROLES: Record<string, string[]> = {
  CTO: ["cto", "chief technology officer", "technology head"],
  CIO: ["cio", "chief information officer"],
  CFO: ["cfo", "chief financial officer", "finance head"],
  COO: ["coo", "chief operating officer", "operations head"],
  CEO: ["ceo", "chief executive", "managing director", "md"],
  Founder: ["founder", "co-founder", "promoter", "proprietor"],
  "Head of IT": ["head of it", "it head", "it manager", "head it"],
  // A VP of IT is not a Head of IT — conflating the two would misstate
  // seniority, which is a scored dimension.
  "VP IT": ["vp of it", "vp it", "vp technology", "vp of technology", "vp information technology"],
  "VP Sales": ["vp sales", "sales head", "head of sales", "cro", "chief revenue"],
  "VP Engineering": ["vp engineering", "engineering head", "head of engineering"],
  "Director of Operations": ["operations director", "director of operations", "plant head", "works manager"],
  "Procurement Head": ["procurement", "purchase head", "purchasing", "sourcing head"],
  "Marketing Head": ["marketing head", "cmo", "head of marketing", "chief marketing"],
  "ERP Programme Manager": ["erp manager", "erp programme", "erp program", "erp lead"],
  "CRM Manager": ["crm manager", "crm owner", "crm lead"],
  "Head of Digital Transformation": ["digital transformation", "head of digital", "transformation lead"],
};

const SENIORITIES: Record<string, string[]> = {
  founder: ["founder", "co-founder", "promoter"],
  "c-level": ["c-level", "c-suite", "cxo", "chief", "cto", "cfo", "ceo", "coo", "cio"],
  vp: ["vp", "vice president"],
  director: ["director"],
  head: ["head of", "head"],
  manager: ["manager"],
  lead: ["team lead", "lead"],
};

const TECHNOLOGIES = [
  "Salesforce", "HubSpot", "Zoho CRM", "Zoho", "Microsoft Dynamics", "Dynamics 365",
  "SAP", "SAP ECC", "SAP S/4HANA", "Oracle NetSuite", "NetSuite", "Oracle EBS", "Oracle",
  "Tally", "QuickBooks", "Busy", "Marg", "Excel", "Google Sheets",
  "AWS", "Azure", "GCP", "Google Cloud", "Snowflake", "Databricks", "BigQuery",
  "Shopify", "WooCommerce", "Magento", "WordPress", "Webflow",
  "Power BI", "Tableau", "Looker", "Metabase",
  "Freshworks", "Freshdesk", "Zendesk", "Intercom",
  "Twilio", "Razorpay", "Stripe", "Segment", "Mixpanel", "Amplitude",
  "Kubernetes", "Jira", "Asana", "Slack", "Teams",
];

/** Buying-trigger language, mapped to a canonical trigger label. */
const TRIGGERS: Record<string, string[]> = {
  "crm migration": ["crm migration", "migrating crm", "moving off", "switching crm", "replacing crm", "new crm"],
  "erp modernisation": ["erp migration", "erp modernisation", "erp modernization", "erp upgrade", "erp implementation", "s/4hana"],
  "hiring for the role": ["hiring", "recruiting", "looking to hire", "job opening", "job post", "vacancy"],
  "digital transformation": ["digital transformation", "digitisation", "digitization", "modernisation programme"],
  "new facility": ["new plant", "new factory", "new facility", "greenfield", "expansion", "capacity expansion"],
  funding: ["raised", "funding", "series a", "series b", "series c", "investment round"],
  "ai automation": ["ai automation", "automate", "automation", "rpa", "ai adoption"],
  "leadership change": ["new cto", "new cio", "new head", "leadership change", "joined as"],
  "published a tender": ["tender", "rfp", "rfq", "request for proposal", "eoi"],
  "spreadsheet dependency": ["spreadsheet", "excel-based", "manual reporting", "on excel"],
  "month-end close delays": ["month end", "month-end", "closing the books", "book close"],
  "competitor dissatisfaction": ["unhappy with", "frustrated with", "problems with", "switching from"],
};

/** Words signalling an exclusion rather than a target. */
const EXCLUSION_CUES = [
  "not ", "except", "excluding", "exclude", "avoid", "no ", "other than", "apart from",
];

const STOPWORDS = new Set([
  "i", "we", "our", "us", "sell", "selling", "sells", "to", "the", "a", "an", "and", "or",
  "with", "that", "who", "which", "are", "is", "am", "in", "on", "of", "for", "from", "by",
  "at", "as", "be", "been", "have", "has", "had", "do", "does", "did", "will", "would",
  "can", "could", "should", "my", "me", "it", "they", "them", "their", "this", "these",
  "those", "there", "here", "where", "when", "how", "what", "why", "all", "any", "some",
  "more", "most", "very", "also", "just", "than", "then", "so", "but", "if", "about",
  "businesses", "business", "companies", "company", "customers", "clients", "employees",
  "people", "team", "teams", "actively", "looking", "want", "wants", "need", "needs",
  "mentioning", "mention", "using", "use", "uses", "run", "runs", "running", "still",
  "between", "around", "under", "over", "up", "down", "into", "out", "across", "each",
  "based", "focused", "specifically", "typically", "usually", "often", "mainly", "mid",
  "market", "mid-market", "size", "sized", "large", "small", "medium", "growing",
]);

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Finds a vocabulary term on word boundaries, tolerating a trailing plural.
 *
 * Substring matching was silently missing "VPs" while looking for "vp ", and
 * would happily match "it" inside "unit".
 */
function findTerm(haystack: string, term: string): number {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Multi-word terms keep internal spacing flexible, and *every* word takes an
  // optional plural — "VPs of IT" pluralises the first word, not the last, so
  // allowing it only at the end missed the phrase entirely.
  const pattern = escaped
    .split(/\s+/)
    .map((word) => `${word}(?:s|es)?`)
    .join("\\s+");
  const re = new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`, "i");
  const match = re.exec(haystack);
  return match ? match.index : -1;
}

/**
 * Finds a stem at the start of a word, letting the word finish however it
 * likes: "manufactur" has to match "manufacturing" and "manufacturer".
 *
 * Only the leading boundary is enforced, so "distribut" will not match inside
 * "redistribute".
 */
function findStem(haystack: string, stem: string): number {
  const escaped = stem.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\s+/g, "\\s+");
  const re = new RegExp(`(?<![a-z0-9])${pattern}`, "i");
  const match = re.exec(haystack);
  return match ? match.index : -1;
}

/** Was this match inside a phrase that negates it? */
function isNegated(text: string, index: number): boolean {
  const window = text.slice(Math.max(0, index - 40), index).toLowerCase();
  return EXCLUSION_CUES.some((cue) => window.includes(cue));
}

export function extractIcp(input: string): Extraction {
  const text = input.trim();
  const lower = text.toLowerCase();

  const matched: Extraction["matched"] = [];
  const consumed: [number, number][] = [];

  /**
   * Records a match and marks *every* occurrence of the matched phrase as
   * accounted for. Marking only the first left later repeats of the same word
   * showing up under "not understood", which read as a contradiction.
   */
  /**
   * Marks every occurrence of `phrase` as accounted for, extending each one to
   * the end of the word it started. A stem like "manufactur" must consume the
   * whole of "manufacturing", or the tail leaks into "not understood".
   */
  const consume = (phrase: string) => {
    const needle = phrase.toLowerCase();
    if (needle.length === 0) return;
    let cursor = lower.indexOf(needle);
    while (cursor !== -1) {
      let end = cursor + needle.length;
      while (end < lower.length && /[a-z0-9]/.test(lower[end])) end += 1;
      consumed.push([cursor, end]);
      cursor = lower.indexOf(needle, cursor + needle.length);
    }
  };

  const record = (field: ExtractionField, value: string, from: string, at: number) => {
    matched.push({ field, value, from });
    if (at < 0) return;
    consume(from);
  };

  const industries = new Set<string>();
  const exclusions = new Set<string>();

  for (const [canonical, patterns] of Object.entries(INDUSTRIES)) {
    for (const pattern of patterns) {
      const at = findStem(lower, pattern);
      if (at === -1) continue;
      if (isNegated(lower, at)) {
        exclusions.add(canonical);
        record("exclusions", canonical, pattern, at);
      } else {
        industries.add(canonical);
        record("industries", canonical, pattern, at);
      }
      break;
    }
  }

  // Locations: regions expand, then explicit states and cities.
  const locations = new Set<string>();
  for (const [cue, expanded] of Object.entries(REGIONS)) {
    const at = findTerm(lower, cue);
    if (at === -1) continue;
    for (const place of expanded) locations.add(place);
    record("locations", expanded.join(", "), cue, at);
  }
  for (const place of [...STATES, ...CITIES]) {
    const at = findTerm(lower, place);
    if (at === -1) continue;
    locations.add(place);
    record("locations", place, place, at);
  }

  // Headcount. Handles "100-1000", "100 to 1000", "over 500", "under 200".
  let employeeMin: number | null = null;
  let employeeMax: number | null = null;

  const range = lower.match(/(\d[\d,]*)\s*(?:-|–|—|to|and)\s*(\d[\d,]*)\s*(?:\+)?\s*(?:employees|people|staff|headcount|fte)/);
  if (range) {
    employeeMin = Number(range[1].replace(/,/g, ""));
    employeeMax = Number(range[2].replace(/,/g, ""));
    record("employeeMin", String(employeeMin), range[0], lower.indexOf(range[0]));
    record("employeeMax", String(employeeMax), range[0], -1);
  } else {
    const over = lower.match(/(?:over|above|more than|at least|>)\s*(\d[\d,]*)\s*(?:employees|people|staff|headcount|fte)/);
    if (over) {
      employeeMin = Number(over[1].replace(/,/g, ""));
      record("employeeMin", String(employeeMin), over[0], lower.indexOf(over[0]));
    }
    const under = lower.match(/(?:under|below|less than|fewer than|up to|<)\s*(\d[\d,]*)\s*(?:employees|people|staff|headcount|fte)/);
    if (under) {
      employeeMax = Number(under[1].replace(/,/g, ""));
      record("employeeMax", String(employeeMax), under[0], lower.indexOf(under[0]));
    }
  }

  const buyerRoles = new Set<string>();
  for (const [canonical, patterns] of Object.entries(ROLES)) {
    for (const pattern of patterns) {
      const at = findTerm(lower, pattern);
      if (at === -1) continue;
      buyerRoles.add(canonical);
      record("buyerRoles", canonical, pattern, at);
      break;
    }
  }

  const seniorities = new Set<string>();
  for (const [canonical, patterns] of Object.entries(SENIORITIES)) {
    for (const pattern of patterns) {
      const at = findTerm(lower, pattern);
      if (at === -1) continue;
      seniorities.add(canonical);
      record("seniorities", canonical, pattern, at);
      break;
    }
  }

  /**
   * A technology can appear in two completely different roles:
   *
   *   "I sell Salesforce implementation"  → what you offer
   *   "companies still running on Tally"  → what the prospect has
   *
   * Treating the first as the prospect's stack inverts the meaning, and for an
   * implementation partner it is actively wrong — their prospects usually do
   * not run the thing yet. So the surrounding words decide which bucket it
   * lands in.
   */
  const SELL_CUES = [
    "sell", "selling", "offer", "offering", "provide", "providing", "implement",
    "implementing", "implementation", "deliver", "delivering", "consult", "we do",
    "our product", "our service", "specialise", "specialize", "build", "migrate to",
  ];
  const STACK_CUES = [
    "running", "runs", "run on", "using", "uses", "use", "on ", "stuck on", "still",
    "currently", "existing", "their", "have", "has", "legacy", "off ", "migrating from",
    "moving off", "replacing", "unhappy with",
  ];

  /**
   * Words that, following a product name, mark it as something being sold or
   * delivered rather than something the prospect already runs. Deliberately
   * excludes "migration" and "replacement", which point the other way.
   */
  const SELL_SUFFIX_CUES = [
    "implementation", "implementations", "partner", "partners", "consultant",
    "consultants", "consulting", "rollout", "rollouts", "deployment",
    "deployments", "practice", "reseller", "integration", "customisation",
    "customization", "services",
  ];

  const technologies = new Set<string>();
  const sellsTechnologies = new Set<string>();
  for (const tech of TECHNOLOGIES) {
    const at = findTerm(lower, tech);
    if (at === -1) continue;

    const before = lower.slice(Math.max(0, at - 45), at);
    const sellHits = SELL_CUES.filter((c) => before.includes(c));
    const stackHits = STACK_CUES.filter((c) => before.includes(c));

    // "Salesforce implementation for manufacturers" has no cue in front of it
    // and used to score 0-0, landing in the prospect's-stack bucket — the
    // opposite of what it says. Only the word immediately after counts: a
    // wider forward window bleeds into the next clause, where
    // "...for distributors currently using Tally" would drag Oracle NetSuite
    // into the stack bucket on cues that belong to Tally.
    const nextWord = /^[\s-]*([a-z]+)/.exec(
      lower.slice(at + tech.length, at + tech.length + 24)
    )?.[1];
    if (nextWord && SELL_SUFFIX_CUES.includes(nextWord)) sellHits.push(nextWord);
    const sellScore = sellHits.length;
    const stackScore = stackHits.length;

    // A cue that decided the bucket was understood, so it must not also be
    // reported as a word we could not account for.
    for (const cue of [...sellHits, ...stackHits]) consume(cue.trim());

    if (sellScore > stackScore) {
      sellsTechnologies.add(tech);
      // Recorded under its own field so the UI can explain the distinction.
      record("sellsTechnologies", tech, tech, at);
    } else {
      technologies.add(tech);
      record("technologies", tech, tech, at);
    }
  }

  const triggerEvents = new Set<string>();
  for (const [canonical, patterns] of Object.entries(TRIGGERS)) {
    const hits = patterns
      .map((pattern) => ({ pattern, at: findStem(lower, pattern) }))
      .filter((h) => h.at !== -1);
    if (hits.length === 0) continue;

    triggerEvents.add(canonical);
    record("triggerEvents", canonical, hits[0].pattern, hits[0].at);
    // "just raised funding" hits both "raised" and "funding". Recording one and
    // consuming only that one left the other under "not understood".
    for (const h of hits.slice(1)) consume(h.pattern);
  }

  // Everything the extractor did not account for — reported rather than hidden.
  const consumedRanges = consumed.sort((a, b) => a[0] - b[0]);
  const leftover: string[] = [];
  let cursor = 0;
  for (const [start, end] of consumedRanges) {
    if (start > cursor) leftover.push(text.slice(cursor, start));
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) leftover.push(text.slice(cursor));

  const unmatchedTerms = [
    ...new Set(
      leftover
        .join(" ")
        .toLowerCase()
        .split(/[^a-z0-9/+.-]+/)
        // "." and "-" are kept inside a token for "node.js" and "co-op", but
        // at the edges they are just sentence punctuation.
        .map((w) => w.trim().replace(/^[.\-/]+/, "").replace(/[.\-/]+$/, ""))
        .filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    ),
  ].slice(0, 20);

  const draft: Extraction["draft"] = {
    sellsDescription: text,
    industries: [...industries],
    locations: [...locations],
    employeeMin,
    employeeMax,
    buyerRoles: [...buyerRoles],
    seniorities: [...seniorities],
    technologies: [...technologies],
    sellsTechnologies: [...sellsTechnologies],
    triggerEvents: [...triggerEvents],
    exclusions: [...exclusions],
  };

  const missing = (
    [
      "industries", "locations", "employeeMin", "employeeMax", "buyerRoles",
      "seniorities", "technologies", "triggerEvents", "exclusions",
    ] as ExtractionField[]
  ).filter((field) => {
    const value = draft[field];
    return Array.isArray(value) ? value.length === 0 : value === null;
  });

  return {
    draft,
    matched,
    missing,
    unmatchedTerms,
    suggestedPhrases: suggestPhrases(draft),
  };
}

/**
 * Builds candidate search phrases from what was matched.
 *
 * Only combines terms that came out of the text — it never invents a vertical
 * or a technology the user did not mention.
 */
export function suggestPhrases(draft: Extraction["draft"]): Extraction["suggestedPhrases"] {
  const out: Extraction["suggestedPhrases"] = [];
  const industries = draft.industries.slice(0, 3);
  const roles = draft.buyerRoles.slice(0, 3);

  // What you SELL and what your prospects RUN need opposite phrases. Someone
  // "looking for an SAP partner" is investing in SAP; if SAP is the system your
  // prospects are trying to leave, that phrase finds you the wrong companies.
  for (const t of draft.sellsTechnologies.slice(0, 3)) {
    out.push({
      phrase: `looking for ${t} implementation partner`,
      sourceKind: "SOCIAL_PUBLIC",
      because: `You sell ${t}. People asking publicly for a partner are the highest-intent signal there is.`,
    });
    out.push({
      phrase: `hiring ${t} administrator`,
      sourceKind: "JOB_BOARD",
      because: `Hiring for a ${t} role usually means the platform decision is already made and budget exists.`,
    });
  }

  for (const t of draft.technologies.slice(0, 3)) {
    out.push({
      phrase: `migrating from ${t}`,
      sourceKind: "SOCIAL_PUBLIC",
      because: `You said your prospects run ${t}. Someone announcing a move off it is already shopping.`,
    });
    out.push({
      phrase: `${t} replacement`,
      sourceKind: "PUBLIC_WEB",
      because: `Companies evaluating a ${t} replacement are in market without having named a vendor yet.`,
    });
  }

  for (const trigger of draft.triggerEvents.slice(0, 4)) {
    if (trigger === "hiring for the role") continue;
    out.push({
      phrase: industries.length > 0 ? `${trigger} ${industries[0].toLowerCase()}` : trigger,
      sourceKind: trigger === "published a tender" ? "TENDER_PORTAL" : "PUBLIC_WEB",
      because: `You listed "${trigger}" as a trigger worth watching for.`,
    });
  }

  if (industries.length > 0 && draft.locations.length > 0) {
    out.push({
      phrase: `new plant announcement ${draft.locations[0]}`,
      sourceKind: "NEWS",
      because: `Physical expansion in ${draft.locations[0]} reliably creates systems work downstream.`,
    });
  }

  for (const role of roles) {
    out.push({
      phrase: `new ${role} appointed`,
      sourceKind: "SOCIAL_PUBLIC",
      because: `A new ${role} re-evaluates vendors in their first 90 days.`,
    });
  }

  // De-duplicate, keeping the first reason given for each phrase.
  const seen = new Set<string>();
  return out.filter((p) => {
    const key = p.phrase.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

export const FIELD_LABEL: Record<ExtractionField, string> = {
  industries: "Industries",
  locations: "Locations",
  employeeMin: "Minimum headcount",
  employeeMax: "Maximum headcount",
  buyerRoles: "Buyer roles",
  seniorities: "Seniority",
  technologies: "Technologies they run",
  sellsTechnologies: "Technologies you sell",
  triggerEvents: "Trigger events",
  exclusions: "Exclusions",
};
