// src/middleware/security.ts
import type { RequestHandler } from "express";
import cors from "cors";
import hpp from "hpp";
import rateLimit from "express-rate-limit";
import express from "express";
import { env } from "../config/env";

/**
 * Strict CORS using allowlist from env.CORS_ORIGINS.
 * - In dev, if the list is empty, default to permissive (origin: true via cb).
 * - In prod, if the list is empty, deny all cross-origin requests.
 */
function buildCorsMiddleware(): RequestHandler {
  const allow = new Set(env.CORS_ORIGINS);

  // Inline-typed origin callback (no dependency on @types/cors exports)
  const origin = (
    requestOrigin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ): void => {
    // Requests without an Origin header (same-origin, curl, server-to-server) should pass
    if (!requestOrigin) return callback(null, true);

    if (allow.size > 0) {
      return callback(null, allow.has(requestOrigin));
    }

    // No explicit allowlist configured:
    if (env.NODE_ENV === "development") {
      return callback(null, true);
    }

    // In production with empty list: block cross-origin by default
    return callback(null, false);
  };

  return cors({
    origin,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Accept",
      "Authorization",
      "Content-Type",
      "If-None-Match",
      "X-Requested-With",
      "X-Request-Id",
      "X-Correlation-Id",
    ],
    exposedHeaders: ["X-Request-Id"],
    maxAge: 86400, // preflight cache (24h)
  });
}

/**
 * Global rate limiter.
 * - Applies to all routes; consider tightening for /auth later.
 * - Returns JSON 429 payload by default.
 */
function buildRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: "draft-7", // RateLimit-* headers
    legacyHeaders: false,
    validate: { trustProxy: true }, // uses app.get('trust proxy')
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests, please try again later.",
      },
    },
  });
}

/**
 * JSON body size limits (and optional urlencoded forms).
 */
function buildBodyParsers(): RequestHandler[] {
  return [
    express.json({ limit: env.JSON_LIMIT }),
    express.urlencoded({ extended: false, limit: env.JSON_LIMIT }),
  ];
}

/** HPP defends against HTTP Parameter Pollution. */
function buildHpp(): RequestHandler {
  return hpp();
}

/**
 * Creates the security middleware stack:
 * - Strict CORS
 * - HPP
 * - Body parsers with enforced size limits
 * - Rate limiting
 */
export function createSecurityMiddleware(): RequestHandler[] {
  return [buildCorsMiddleware(), buildHpp(), ...buildBodyParsers(), buildRateLimiter()];
}
