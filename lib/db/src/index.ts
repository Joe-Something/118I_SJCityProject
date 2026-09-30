import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { PoolClient } from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export const databaseConfigured = Boolean(process.env.DATABASE_URL);

// Never let pg silently fall back to its default localhost connection. Keeping
// an explicitly unusable pool lets read-only staff queues use their sample
// fallback when a deployment has not provisioned the database yet.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://unconfigured:unconfigured@127.0.0.1:1/unconfigured",
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
  statement_timeout: 10_000,
  query_timeout: 12_000,
});
// pg emits idle-client errors asynchronously; the next request's bounded
// retry/fallback path handles them without crashing the process.
let poolErrorHandler: (error: Error) => void = () => undefined;
pool.on("error", error => poolErrorHandler(error));
export function setDatabasePoolErrorHandler(handler: (error: Error) => void): void {
  poolErrorHandler = handler;
}
export const db = drizzle(pool, { schema });

let schemaReady = false;
let schemaInitialization: Promise<void> | null = null;

/**
 * Additive, idempotent initialization for the permit application tables used
 * by the application API. This intentionally does not replace or migrate
 * unrelated project tables.
 */
export async function initializePermitApplicationSchema(): Promise<void> {
  if (schemaReady) return;
  if (schemaInitialization) return schemaInitialization;

  const initialization = (async () => {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      // Serialize schema setup across application replicas while PostgreSQL
      // holds the lock for this transaction.
      await client.query("SELECT pg_advisory_xact_lock(1297304400, 1397834054)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS permit_applications (
          id text PRIMARY KEY,
          owner_id text,
          applicant_key text,
          business_name text NOT NULL,
          business_category text NOT NULL,
          request_type text NOT NULL,
          status text NOT NULL,
          assigned_department text NOT NULL,
          applicant_language text NOT NULL,
          submitted_at timestamptz,
          description text NOT NULL,
          notes text,
          synthetic boolean NOT NULL DEFAULT true,
          source_url text,
          source_dataset text,
          source_date timestamptz,
          source_imported_at timestamptz,
          plan jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS permit_status_history (
          id text PRIMARY KEY,
          application_id text NOT NULL REFERENCES permit_applications(id),
          status text NOT NULL,
          actor text NOT NULL,
          is_synthetic boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS application_documents (
          id text PRIMARY KEY,
          application_id text NOT NULL,
          name text NOT NULL,
          size integer NOT NULL,
          content_type text NOT NULL,
          staging_object_id text NOT NULL UNIQUE,
          final_object_id text NOT NULL UNIQUE,
          final_generation text,
          state text NOT NULL DEFAULT 'pending',
          upload_expires_at timestamptz NOT NULL,
          upload_url_expires_at timestamptz NOT NULL,
          staging_cleaned_at timestamptz,
          uploaded_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS application_document_audit (
          id text PRIMARY KEY,
          application_id text NOT NULL,
          document_id text,
          actor_id text NOT NULL,
          actor_department text,
          action text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      // Repair older partial installations additively, using safe defaults for
      // required fields so existing rows and user data remain intact.
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS owner_id text");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS applicant_key text");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS business_name text NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS business_category text NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Draft'");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS assigned_department text NOT NULL DEFAULT 'Planning'");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS applicant_language text NOT NULL DEFAULT 'English'");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS submitted_at timestamptz");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS notes text");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT true");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS source_url text");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS source_dataset text");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS source_date timestamptz");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS source_imported_at timestamptz");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS plan jsonb NOT NULL DEFAULT '{}'::jsonb");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()");
      await client.query("ALTER TABLE permit_applications ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()");
      await client.query("CREATE INDEX IF NOT EXISTS permit_applications_owner_idx ON permit_applications(owner_id, applicant_key, updated_at DESC)");
      await client.query("CREATE INDEX IF NOT EXISTS permit_applications_department_idx ON permit_applications(assigned_department, submitted_at DESC)");
      // Additive repairs for columns used by current document/history flows.
      await client.query("ALTER TABLE permit_status_history ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT true");
      await client.query("ALTER TABLE permit_status_history ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()");
      await client.query("ALTER TABLE permit_status_history ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()");
      await client.query("ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS final_generation text");
      await client.query("ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'pending'");
      await client.query("ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS upload_expires_at timestamptz NOT NULL DEFAULT now()");
      await client.query("ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS upload_url_expires_at timestamptz NOT NULL DEFAULT now()");
      await client.query("ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS staging_cleaned_at timestamptz");
      await client.query("ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS uploaded_at timestamptz");
      await client.query("ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()");
      await client.query("ALTER TABLE application_document_audit ADD COLUMN IF NOT EXISTS document_id text");
      await client.query("ALTER TABLE application_document_audit ADD COLUMN IF NOT EXISTS actor_department text");
      await client.query("ALTER TABLE application_document_audit ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()");
      await client.query("CREATE UNIQUE INDEX IF NOT EXISTS application_documents_staging_object_id_key ON application_documents(staging_object_id)");
      await client.query("CREATE UNIQUE INDEX IF NOT EXISTS application_documents_final_object_id_key ON application_documents(final_object_id)");
      await client.query("COMMIT");
      schemaReady = true;
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client?.release();
    }
  })();
  schemaInitialization = initialization.finally(() => {
    schemaInitialization = null;
  });
  return schemaInitialization;
}

export function resetPermitApplicationSchemaReadiness(): void {
  schemaReady = false;
}

export * from "./schema";
