// src/middleware/auth.ts
import type { RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";
import { verifyAccessToken, parseRawApiKey, verifyApiKeySecret } from "../lib/auth";

const prisma = new PrismaClient();

/**
 * Authenticate via:
 * - httpOnly JWT in outliers_session cookie, or
 * - Bearer JWT in Authorization header, or
 * - API Key in X-API-Key header
 *
 * If multiple are present, prefer user context (cookie or Bearer).
 */
export const authenticate: RequestHandler = async (req, res, next) => {
  try {
    // 1) Cookie based session
    const cookieToken = (req as any).cookies?.outliers_session as string | undefined;
    if (cookieToken) {
      const payload = verifyAccessToken(cookieToken);
      req.user = payload;
      return next();
    }

    // 2) Bearer JWT
    const auth = req.header("authorization");
    if (auth?.startsWith("Bearer ")) {
      const token = auth.slice("Bearer ".length).trim();
      const payload = verifyAccessToken(token);
      req.user = payload;
      return next();
    }

    // 3) API key in X-API-Key
    const apiKeyRaw = req.header("x-api-key");
    if (apiKeyRaw) {
      const parsed = parseRawApiKey(apiKeyRaw);
      if (!parsed) return unauthorized(res, "INVALID_API_KEY_FORMAT");

      const apiKey = await prisma.apiKey.findUnique({ where: { id: parsed.id } });
      if (!apiKey || apiKey.revokedAt) {
        return unauthorized(res, "API_KEY_REVOKED_OR_MISSING");
      }

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

    return unauthorized(res, "AUTH_REQUIRED");
  } catch (err) {
    return next(err);
  }
};

function unauthorized(res: any, code: string) {
  return res.status(401).json({ error: { code, message: "Unauthorized" } });
}

/**
 * Require the request to be scoped to an org (either via user or apiKey).
 */
export function requireOrg(orgField: "orgId" = "orgId"): RequestHandler {
  return (req, res, next) => {
    const orgId = req.user?.orgId ?? req.apiKeyAuth?.orgId;
    if (!orgId) {
      return res
        .status(403)
        .json({ error: { code: "ORG_REQUIRED", message: "Organization scope required" } });
    }
    (res.locals as any).orgId = orgId;
    next();
  };
}

/**
 * Simple RBAC role guard for user JWTs (OWNER, ADMIN, USER, AUDITOR).
 */
export function requireRoles(roles: Array<"OWNER" | "ADMIN" | "USER" | "AUDITOR">): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(403)
        .json({ error: { code: "USER_REQUIRED", message: "User token required" } });
    }
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: { code: "INSUFFICIENT_ROLE", message: "Forbidden" } });
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
      return res
        .status(403)
        .json({ error: { code: "API_KEY_REQUIRED", message: "API key required" } });
    }
    const have = new Set(req.apiKeyAuth.scopes ?? []);
    const ok = scopes.every((s) => have.has(s));
    if (!ok) {
      return res
        .status(403)
        .json({ error: { code: "INSUFFICIENT_SCOPE", message: "Forbidden" } });
    }
    next();
  };
}
