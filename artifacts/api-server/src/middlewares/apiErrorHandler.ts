import type { ErrorRequestHandler } from "express";

export const apiErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  req.log.error({ err: error }, "Unhandled API error");
  res.status(500).json({ error: "Internal server error." });
};