// src/middleware/error.ts
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../logger";

/**
 * 404 for unknown routes, with a consistent JSON shape.
 * Place this AFTER all routes but BEFORE errorHandler.
 */
export const notFound: RequestHandler = (req, res) => {
  const requestId = (req as any).id as string | undefined;
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
      requestId,
    },
  });
};

/**
 * Centralized error handler. Normalizes:
 * - Zod validation errors → 400 with issue details
 * - JSON parse errors (malformed) → 400
 * - Payload too large → 413
 * - express-rate-limit rejections → 429
 * - Everything else → 500
 *
 * Logs exactly once with appropriate severity and includes requestId for correlation.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = (req as any).id as string | undefined;

  // 1) Body parser errors: malformed JSON or payload too large
  if (isInvalidJsonError(err)) {
    const status = err.type === "entity.too.large" ? 413 : 400;
    const payload = {
      error: {
        code: status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON",
        message: status === 413 ? "Request body is too large" : "Malformed JSON in request body",
        requestId,
      },
    };
    logOnce(status, err, requestId);
    return res.status(status).json(payload);
  }

  // 2) Zod validation errors
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
      code: i.code,
    }));
    const payload = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details,
        requestId,
      },
    };
    logOnce(400, err, requestId);
    return res.status(400).json(payload);
  }

  // 3) express-rate-limit (varies by version; check both status/statusCode)
  //    Some versions forward our message directly; normalize just in case.
  const statusFromLimiter =
    (typeof (err as any)?.status === "number" && (err as any).status) ||
    (typeof (err as any)?.statusCode === "number" && (err as any).statusCode);

  if (statusFromLimiter === 429) {
    const msg =
      typeof (err as any)?.message === "string"
        ? (err as any).message
        : "Too many requests, please try again later.";
    const payload = {
      error: {
        code: "RATE_LIMITED",
        message: msg,
        requestId,
      },
    };
    logOnce(429, err, requestId);
    return res.status(429).json(payload);
  }

  // 4) Fallback: Internal Server Error
  const payload = {
    error: {
      code: "INTERNAL",
      message: "Internal Server Error",
      requestId,
    },
  };
  logOnce(500, err, requestId);
  return res.status(500).json(payload);
};

// ---------- helpers ----------

function isInvalidJsonError(err: unknown): err is SyntaxError & { type?: string } {
  // express.json() / body-parser errors:
  // - malformed: err instanceof SyntaxError OR err.type === "entity.parse.failed"
  // - too large: err.type === "entity.too.large"
  if (!err || typeof err !== "object") return false;
  const e = err as any;
  return (
    err instanceof SyntaxError ||
    e?.type === "entity.parse.failed" ||
    e?.type === "entity.too.large"
  );
}

function logOnce(status: number, err: unknown, requestId?: string) {
  const meta = { status, requestId };
  const msg = (err as any)?.message ?? "Unhandled error";

  if (status >= 500) {
    logger.error({ err, ...meta }, msg);
  } else {
    logger.warn({ err, ...meta }, msg);
  }
}
