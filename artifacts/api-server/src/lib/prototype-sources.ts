/**
 * Synthetic example references for source-aware answers. None is a City
 * publication, fee schedule, permit record or alert, or a live City workflow.
 * The City links are for independent verification only and must never be
 * presented as provenance for the synthetic content.
 */
const documents = [
  {
    id: "demo-planning-rules",
    topic: "rules",
    title: "Synthetic example: planning and zoning checklist",
    version: "synthetic-example-1",
    revisedAt: "2026-09-29T00:00:00.000Z",
    officialReferenceUrl: "https://www.sanjoseca.gov/business/development-services-permit-center/online-permits-at-sjpermits-org/planning-online-permits",
    content: "Synthetic example: a new storefront operator records their proposed use and asks the planning counter which zoning or sign review path may apply. This checklist does not determine zoning or authorize work, and is not a live City workflow.",
  },
  {
    id: "demo-building-rules",
    topic: "rules",
    title: "Synthetic example: building project checklist",
    version: "synthetic-example-1",
    revisedAt: "2026-09-29T00:00:00.000Z",
    officialReferenceUrl: "https://www.sanjoseca.gov/your-government/departments-offices/planning-building-code-enforcement/building-division",
    content: "Synthetic example: describe changes to walls, electrical, plumbing, HVAC or exterior work, then ask the City which plan review, inspection and permits apply. This example is not a code interpretation or a live City workflow.",
  },
  {
    id: "demo-fees",
    topic: "fees",
    title: "Synthetic example: fee review worksheet",
    version: "synthetic-example-1",
    revisedAt: "2026-09-29T00:00:00.000Z",
    officialReferenceUrl: "https://www.sanjoseca.gov/your-government/departments-offices/planning-building-code-enforcement/building-division/building-permit-fees",
    content: "Synthetic example: collect project type, scope and valuation before asking the City for a fee estimate. No dollar figures or fee calculation are provided; this is not a live City workflow.",
  },
  {
    id: "demo-status",
    topic: "status",
    title: "Synthetic example: permit status walkthrough",
    version: "synthetic-example-1",
    revisedAt: "2026-09-29T00:00:00.000Z",
    officialReferenceUrl: "https://permits.sanjoseca.gov/search/",
    content: "Synthetic example: a sample application moves from draft to review to a decision. These are illustrative stages only; no individual permit was looked up, no live status is available here, and this is not a live City workflow.",
  },
  {
    id: "demo-alerts",
    topic: "alerts",
    title: "Synthetic example: service notice workflow",
    version: "synthetic-example-1",
    revisedAt: "2026-09-29T00:00:00.000Z",
    officialReferenceUrl: "https://www.sanjoseca.gov/business/development-services-permit-center",
    content: "Synthetic example: a sample notice might ask applicants to confirm counter hours before visiting. This is not an active alert or live City workflow; check the City directly for service changes or emergencies.",
  },
] as const;

export function prototypeSources(now = new Date()) {
  const checkedAt = now.toISOString();
  return documents.map(document => {
    const revised = Date.parse(document.revisedAt);
    const valid = !!document.content.trim() && !!document.version && Number.isFinite(revised) && revised <= now.getTime();
    return {
      ...document,
      checkedAt,
      state: !valid ? "unavailable" as const
        : now.getTime() - revised > 365 * 24 * 60 * 60 * 1000 ? "outdated" as const : "demo" as const,
    };
  });
}