import type { ErrorRequestHandler } from "express";
import { databaseErrorCode, isDatabaseUnavailable } from "../lib/databaseResilience";

export const apiErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (isDatabaseUnavailable(error)) {
    req.log.warn({ code: databaseErrorCode(error) }, "Database request failed; retry may succeed");
    res.setHeader("Retry-After", "30");
    res.status(503).json({ error: "Application storage is temporarily unavailable. Please retry shortly." });
    return;
  }

  req.log.error({ err: error }, "Unhandled API error");
  res.status(500).json({ error: "Internal server error." });
};