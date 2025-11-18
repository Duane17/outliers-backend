// src/middleware/auth.ts
import type { Request, Response, RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";
import { verifyAccessToken, parseRawApiKey, verifyApiKeySecret } from "../lib/auth";

const prisma = new PrismaClient();

/**
 * Minimal cookie lookup that works with or without cookie parser.
 * - If req.cookies exists (from cookie parser), use that.
 * - Otherwise parse the Cookie header manually.
 */
function getCookie(req: Request & { cookies?: Record<string, string> }, name: string): string | undefined {
  // If cookie parser is mounted, prefer that
  if (req.cookies && typeof req.cookies[name] === "string") {
    return req.cookies[name];
  }

  const header = req.headers.cookie;
  if (!header || typeof header !== "string") return undefined;

  const parts = header.split(";");
  for (const part of parts) {
    const [rawKey, ...rawVal] = part.trim().split("=");
    const key = decodeURIComponent(rawKey);
    if (key === name) {
      return decodeURIComponent(rawVal.join("="));
    }
  }

  return undefined;
}

function unauthorized(res: Response, code: string) {
  return res.status(401).json({ error: { code, message: "Unauthorized" } });
}

/**
 * Authenticate via, in order of preference:
 * 1. Bearer JWT in Authorization header
 * 2. API Key in X-API-Key header
 * 3. Session cookie "outliers_session"
 *
 * The first mechanism that succeeds populates req.user or req.apiKeyAuth and calls next().
 */
export const authenticate: RequestHandler = async (req, res, next) => {
  try {
    const auth = req.header("authorization");
    const apiKeyRaw = req.header("x-api-key");

    // 1) Bearer token (user context, used by programmatic clients or future SDK)
    if (auth?.startsWith("Bearer ")) {
      const token = auth.slice("Bearer ".length).trim();
      const payload = verifyAccessToken(token);
      req.user = payload;
      return next();
    }

    // 2) API key (service to service, no user context)
    if (apiKeyRaw) {
      const parsed = parseRawApiKey(apiKeyRaw);
      if (!parsed) return unauthorized(res, "INVALID_API_KEY_FORMAT");

      const apiKey = await prisma.apiKey.findUnique({ where: { id: parsed.id } });
      if (!apiKey || apiKey.revokedAt) return unauthorized(res, "API_KEY_REVOKED_OR_MISSING");

      if (!verifyApiKeySecret(parsed.secret, apiKey.keyHash)) {
        return unauthorized(res, "API_KEY_INVALID");
      }

      req.apiKeyAuth = {
        apiKeyId: apiKey.id,
        orgId: apiKey.orgId,
        scopes: apiKey.scopes ?? [],
      };
      return next();
    }

    // 3) Session cookie from browser login
    const sessionToken = getCookie(req as any, "outliers_session");
    if (sessionToken) {
      try {
        const payload = verifyAccessToken(sessionToken);
        req.user = payload;
        return next();
      } catch {
        return unauthorized(res, "AUTH_REQUIRED");
      }
    }

    // Nothing usable found
    return unauthorized(res, "AUTH_REQUIRED");
  } catch (err) {
    return next(err);
  }
};

/**
 * Require the request to be scoped to an org (either via user or apiKey).
 */
export function requireOrg(orgField: "orgId" = "orgId"): RequestHandler {
  return (req, res, next) => {
    const orgId = req.user?.[orgField] ?? req.apiKeyAuth?.orgId;
    if (!orgId) {
      return res.status(403).json({
        error: { code: "ORG_REQUIRED", message: "Organization scope required" },
      });
    }
    (res.locals as any).orgId = orgId;
    next();
  };
}

/**
 * Simple RBAC role guard for user JWTs.
 */
export function requireRoles(roles: Array<"OWNER" | "ADMIN" | "USER" | "AUDITOR">): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({
        error: { code: "USER_REQUIRED", message: "User token required" },
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: { code: "INSUFFICIENT_ROLE", message: "Forbidden" },
      });
    }
    next();
  };
}

/**
 * API key scope guard.
 */
export function requireScopes(scopes: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.apiKeyAuth) {
      return res.status(403).json({
        error: { code: "API_KEY_REQUIRED", message: "API key required" },
      });
    }

    const have = new Set(req.apiKeyAuth.scopes ?? []);
    const ok = scopes.every((s) => have.has(s));

    if (!ok) {
      return res.status(403).json({
        error: { code: "INSUFFICIENT_SCOPE", message: "Forbidden" },
      });
    }

    next();
  };
}
