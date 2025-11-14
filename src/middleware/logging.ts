import type { RequestHandler } from "express";
import pinoHttp from "pino-http";
import morgan from "morgan";
import crypto from "node:crypto";
import { logger } from "../logger";

/**
 * Create request logging middleware stack:
 * - pino-http: structured logs, request lifecycle
 * - requestId: robust correlation ID generation + X-Request-Id header
 * - morgan (dev only): human-friendly single-line summary
 */
export function createLoggingMiddleware(isDev: boolean): RequestHandler[] {
  // Generate a stable request ID for every request
  const genReqId = (req: any, res: any) => {
    const incoming =
      (req.headers["x-request-id"] as string | undefined) ||
      (req.headers["x-correlation-id"] as string | undefined);

    // Prioritize a valid incoming id if present; else mint a new one.
    const id = incoming && incoming.trim().length > 0 ? incoming : crypto.randomUUID();

    // Surface it back to clients so they can reference it in bug reports.
    res.setHeader("X-Request-Id", id);
    return id;
  };

  const pinoMw = pinoHttp({
    logger,
    genReqId,
    // Don’t spam logs for noisy endpoints
    autoLogging: {
      ignore: (req) => req.url === "/healthz",
    },
    customLogLevel(res, err) {
      const status = res.statusCode ?? 500;
      if (status >= 500 || err) return "error";
      if (status >= 400) return "warn";
      return "info";
    },
    // Include requestId on every log record for easy querying
    customProps(req, _res) {
      return { requestId: req.id };
    },
    // Optional nicer success/error lines
    customSuccessMessage(req, res) {
      return `${req.method} ${req.url} ${res.statusCode}`;
    },
    customErrorMessage(req, res, err) {
      return `${req.method} ${req.url} ${res.statusCode} - ${err?.message ?? "error"}`;
    },
  });

  // In development, add a pretty, one-line morgan summary alongside pino
  const morganMw: RequestHandler | null = isDev
    ? morgan(':method :url :status :res[content-length] - :response-time ms reqId=:req[x-request-id]', {
        skip: (req) => req.url === "/healthz",
        stream: {
          write: (line) => logger.info({ morgan: line.trim() }),
        },
      })
    : null;

  return morganMw ? [pinoMw, morganMw] : [pinoMw];
}
