import type { Application } from "@workspace/db";

const categories = ["Cafe", "Bakery", "Grocery", "Salon", "Retail", "Restaurant", "Repair"];
const statuses = [
  "Draft — Requires Review",
  "In Review (Re-opened)",
  "Approved",
  "Modified via Staff Override",
];
const departments = ["Planning", "Building", "Fire", "Economic Development"];

/** Stable, explicitly synthetic records used both by startup seeding and outage fallback. */
export function createDemoApplications(now = new Date()): Application[] {
  return Array.from({ length: 24 }, (_, index) => {
    const number = index + 1;
    const category = categories[index % categories.length]!;
    const status = statuses[index % statuses.length]!;
    const department = departments[index % departments.length]!;
    const language = index === 2 ? "es" : "en";
    const id = `DEMO-D2-${String(number).padStart(4, "0")}`;
    const businessName = `Demo ${category} ${number}`;
    const description = index === 2
      ? "Solicitud de ejemplo para una pequeña panadería en el Distrito 2"
      : `${category} example project: ${[
          "tenant improvement and interior renovation",
          "new business opening with accessibility upgrades",
          "commercial kitchen equipment replacement",
          "signage, lighting, and exterior frontage improvements",
        ][index % 4]}`;
    const contactName = `Sample Applicant ${number}`;
    const contactEmail = `sample-applicant-${number}@example.invalid`;
    const contactPhone = `(408) 555-${String(1000 + number).slice(-4)}`;
    const plan: Record<string, unknown> = {
      id,
      intake: {
        businessName,
        businessType: category.toLowerCase(),
        address: `${100 + number} Example Avenue`,
        zip: "95113",
        description,
        applicantName: contactName,
        applicantEmail: contactEmail,
        applicantPhone: contactPhone,
        modifications: [],
        files: [],
      },
      status,
      language,
      matched: [],
      departments: [department],
      notes: { [department.toLowerCase()]: "Sample record for internal workflow demonstration only." },
      overrides: {},
      rejected: [],
    };
    return {
      id,
      ownerId: null,
      applicantKey: null,
      businessName,
      businessCategory: category,
      requestType: "Business Permit Review",
      status,
      assignedDepartment: department,
      applicantLanguage: language === "es" ? "Spanish" : "English",
      submittedAt: new Date(now.getTime() - index * 86_400_000),
      description,
      notes: "Synthetic staff-training example. Contact details use the reserved example.invalid domain.",
      synthetic: true,
      sourceUrl: null,
      sourceDataset: "internal-demo-seed",
      sourceDate: null,
      sourceImportedAt: null,
      plan,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  });
}

export function isDemoApplicationId(id: string): boolean {
  return /^DEMO-D2-\d{4}$/.test(id);
}

/** In-memory copy of staff search semantics for use only when PostgreSQL is unavailable. */
export function filterDemoApplications(
  records: Application[],
  department: string,
  filters: Record<string, string | undefined>,
): Application[] {
  const searchable: Array<[keyof typeof filters, (record: Application) => string]> = [
    ["applicationId", record => record.id],
    ["businessName", record => record.businessName],
    ["businessCategory", record => record.businessCategory],
    ["requestType", record => record.requestType],
    ["status", record => record.status],
    ["assignedDepartment", record => record.assignedDepartment],
    ["applicantLanguage", record => record.applicantLanguage],
    ["descriptionOrNotes", record => `${record.description} ${record.notes ?? ""}`],
  ];
  return records.filter(record => {
    if (department !== "Economic Development" &&
        !record.assignedDepartment.split(",").some(value => value.trim() === department)) return false;
    for (const [filter, value] of searchable) {
      const term = filters[filter]?.trim().toLocaleLowerCase();
      if (term && !value(record).toLocaleLowerCase().includes(term)) return false;
    }
    const search = filters.search?.trim().toLocaleLowerCase();
    if (search && ![
      record.id, record.businessName, record.businessCategory, record.requestType,
      record.status, record.assignedDepartment, record.applicantLanguage,
      record.description, record.notes ?? "",
    ].some(value => value.toLocaleLowerCase().includes(search))) return false;
    if (filters.submissionDate && record.submittedAt?.toISOString().slice(0, 10) !== filters.submissionDate) return false;
    return true;
  });
}