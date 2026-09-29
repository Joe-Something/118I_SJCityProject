import { db, applicationsTable, statusHistoryTable } from "@workspace/db";
import { logger } from "./logger";

const categories = ["Cafe", "Bakery", "Grocery", "Salon", "Retail", "Restaurant", "Repair"];
const statuses = ["Draft — Requires Review", "In Review (Re-opened)", "Approved", "Modified via Staff Override"];
const departments = ["Planning", "Building", "Fire"];

/** Stable IDs and conflict-safe inserts make this safe to run on every startup. */
export async function seedDemoApplications() {
  const now = new Date();
  const rows = Array.from({ length: 24 }, (_, index) => {
    const number = index + 1;
    const duplicate = index === 1;
    const language = index === 2 ? "es" : "en";
    const description = duplicate ? "Demo neighborhood cafe interior renovation" :
      index === 0 ? "Demo neighborhood cafe interior renovation" :
      index === 2 ? "Solicitud de ejemplo para una pequeña panadería en el Distrito 2" :
      `Synthetic District 2 ${categories[index % categories.length].toLowerCase()} permit scenario ${number}`;
    const status = statuses[index % statuses.length];
    const category = categories[index % categories.length];
    const department = departments[index % departments.length];
    const id = `DEMO-D2-${String(number).padStart(4, "0")}`;
    const plan = {
      id, intake: { businessName: `Demo ${category} ${number}`, businessType: category.toLowerCase(),
        address: "", zip: "", description, modifications: [], files: [] },
      status, language, matched: [], departments: [department],
      notes: {}, overrides: {}, rejected: [],
    };
    return {
      id, ownerId: null, applicantKey: null, businessName: `Demo ${category} ${number}`,
      businessCategory: category, requestType: "Business Permit Review",
      status, assignedDepartment: department,
      applicantLanguage: language === "es" ? "Spanish" : "English",
      description, notes: index === 3 ? null : "Synthetic training example",
      synthetic: true, submittedAt: now, plan,
    };
  });
  await db.insert(applicationsTable).values(rows).onConflictDoNothing();
  await db.insert(statusHistoryTable).values(rows.map(row => ({
    id: `SEED-${row.id}`, applicationId: row.id, status: row.status,
    actor: "Demo seed", synthetic: true,
  }))).onConflictDoNothing();
  logger.info({ records: rows.length }, "Ensured synthetic District 2 demonstration records");
}