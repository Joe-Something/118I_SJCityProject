import {
  databaseConfigured,
  initializePermitApplicationSchema,
  resetPermitApplicationSchemaReadiness,
  setDatabasePoolErrorHandler,
} from "@workspace/db";
import { seedDemoApplications } from "./seed-demo";
import { logger } from "./logger";

setDatabasePoolErrorHandler(error => {
  logger.warn({ code: databaseErrorCode(error) }, "Idle database connection reported an error");
});

const retryableCodes = new Set([
  "08000", "08003", "08006", "08001", "53300", "57P01", "57P02", "57P03",
  "40001", "40P01", "42P01", "42703", "ECONNREFUSED", "ECONNRESET",
  "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN",
  "28P01", "28000", "3D000",
]);

export function databaseErrorCode(error: unknown): string | undefined {
  for (const candidate of errorChain(error)) {
    if (typeof candidate.code === "string") return candidate.code;
  }
  return undefined;
}

export function isDatabaseUnavailable(error: unknown): boolean {
  for (const candidate of errorChain(error)) {
    if (typeof candidate.code === "string" && retryableCodes.has(candidate.code)) return true;
    if (candidate.code === "57014" && /canceling statement due to statement timeout/i.test(candidate.message ?? "")) {
      return true;
    }

    const message = candidate.message?.trim() ?? "";
    if (/^timeout exceeded when trying to connect\.?$/i.test(message) ||
        /^connection terminated due to connection timeout\.?$/i.test(message) ||
        /^query read timeout\.?$/i.test(message)) return true;
  }
  return false;
}

function* errorChain(error: unknown): Generator<{ code?: unknown; message?: string; cause?: unknown }> {
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    yield {
      code: candidate.code,
      message: typeof candidate.message === "string" ? candidate.message : undefined,
      cause: candidate.cause,
    };
    current = candidate.cause;
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A small bounded retry around database-dependent reads, including schema readiness. */
export async function withDatabaseRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await initializePermitApplicationSchema();
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isDatabaseUnavailable(error) || attempt === 1) throw error;
      resetPermitApplicationSchemaReadiness();
      await delay(100);
    }
  }
  throw lastError;
}

/** Initialize and seed with bounded exponential retries; safe to call after outages. */
export async function initializeAndSeedApplications(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await initializePermitApplicationSchema();
      await seedDemoApplications();
      return;
    } catch (error) {
      lastError = error;
      resetPermitApplicationSchemaReadiness();
      if (!isDatabaseUnavailable(error) || attempt === 3) break;
      await delay(250 * (2 ** attempt));
    }
  }
  const code = databaseErrorCode(lastError);
  logger.warn({ code, configured: databaseConfigured }, "Application database initialization is unavailable; staff sample fallback remains enabled");
}

export function scheduleDatabaseRecovery(): void {
  void initializeAndSeedApplications();
  const timer = setInterval(() => void initializeAndSeedApplications(), 60_000);
  timer.unref();
}