import { db, applicationsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

// City of San José Open Data: Last 30 days building permits (updated daily).
// Never import the CSV's applicant, owner, contractor or parcel-number columns.
export const PUBLIC_PERMITS_DATASET = "https://data.sanjoseca.gov/dataset/last-30-days-building-permits";
const PUBLIC_PERMITS_CSV = "https://data.sanjoseca.gov/dataset/2723cdec-a639-4b63-bded-175338c45473/resource/045b3678-e923-4002-b696-300955bc6d06/download/buildingpermits30.csv";

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      if (row.some(value => value.trim())) rows.push(row);
      row = []; field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("Unterminated CSV quoted field");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function issueDate(value: string): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]), 12));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function refreshPublicPermits() {
  const response = await fetch(PUBLIC_PERMITS_CSV, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`City permit dataset responded ${response.status}`);
  const csv = await response.text();
  if (csv.length > 6_000_000) throw new Error("City permit dataset exceeds expected size");
  const [header, ...data] = parseCsv(csv);
  const required = ["FOLDERNUMBER", "FOLDERDESC", "gx_location", "FOLDERNAME", "SUBTYPEDESCRIPTION", "WORKDESCRIPTION", "ISSUEDATE"];
  if (!header || required.some(column => !header.includes(column))) throw new Error("City permit dataset format changed");
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  const field = (row: string[], name: string) => (row[index[name]] || "").trim();
  const importedAt = new Date();
  const rows = data
    .filter(row => field(row, "FOLDERDESC") === "Commercial/Industrial")
    .map(row => {
      const permitNumber = field(row, "FOLDERNUMBER");
      const address = field(row, "gx_location").replace(/\s+/g, " ").trim();
      const date = issueDate(field(row, "ISSUEDATE"));
      if (!/^\d{4}-[\d-]+-CI$/.test(permitNumber) || !address || !date) return null;
      const id = `SJ-OPEN-${permitNumber}`;
      const businessName = `Property at ${address}`;
      const category = field(row, "SUBTYPEDESCRIPTION") || "Not provided";
      const work = field(row, "WORKDESCRIPTION") || "Building permit";
      const description = field(row, "FOLDERNAME") || work;
      return {
        id, ownerId: null, applicantKey: null,
        businessName, businessCategory: category, requestType: work,
        status: "Issued", assignedDepartment: "Not provided", applicantLanguage: "Not provided",
        submittedAt: null, description, notes: null, synthetic: false,
        sourceUrl: PUBLIC_PERMITS_DATASET, sourceDataset: "City of San José · Last 30 days building permits",
        sourceDate: date, sourceImportedAt: importedAt,
        plan: {
          id, intake: { businessName, businessType: "other", businessOther: category, address,
            zip: "", description, modifications: [], modificationOther: "", files: [] },
          language: "en", customLanguage: "", simplified: false,
          createdAt: date.getTime(), updatedAt: date.getTime(),
          status: "Issued", notes: {}, overrides: {}, rejected: [], matched: [],
        },
        createdAt: importedAt, updatedAt: importedAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.sourceDate.getTime() - a.sourceDate.getTime())
    .slice(0, 60);
  if (!rows.length) throw new Error("City permit dataset contains no usable commercial records");
  // Preserve the last known import if the City download or parsing fails.
  // Historical rows remain labeled with their original import timestamp.
  await db.transaction(async tx => {
    await tx.insert(applicationsTable).values(rows).onConflictDoUpdate({
      target: applicationsTable.id,
      set: {
        businessName: sql`excluded.business_name`,
        businessCategory: sql`excluded.business_category`,
        requestType: sql`excluded.request_type`,
        status: sql`excluded.status`,
        description: sql`excluded.description`,
        sourceDate: sql`excluded.source_date`,
        sourceImportedAt: importedAt,
        plan: sql`excluded.plan`,
        updatedAt: importedAt,
      },
    });
  });
  logger.info({ imported: rows.length, source: PUBLIC_PERMITS_DATASET }, "Refreshed City public permit records");
}

export function schedulePublicPermitRefresh() {
  const run = () => void refreshPublicPermits().catch(error => {
    logger.warn({ err: error }, "Could not refresh public permits; keeping previously imported records");
  });
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}