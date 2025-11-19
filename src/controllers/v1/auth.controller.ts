// src/controllers/v1/auth.controller.ts
import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { PrismaClient, OrgVerificationMethod, Role } from "@prisma/client";
import { getInput } from "../../middleware/validate";
import { signupSchema, loginSchema } from "../../schemas/auth";
import { hashPassword, verifyPassword, signAccessToken } from "../../lib/auth";
import { logger } from "../../logger";

const prisma = new PrismaClient();
const isProduction = process.env.NODE_ENV === "production";

/**
 * Simple in memory tracking of failed login attempts.
 * One map keyed by IP, one by email (normalised).
 */
type LoginThrottleState = {
  count: number;
  lastAttempt: number;
  blockedUntil?: number;
};

const FAILED_LOGIN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const FAILED_LOGIN_MAX_ATTEMPTS = 5;
const FAILED_LOGIN_BLOCK_MS = 60 * 1000; // 1 minute temporary block
const FAILED_LOGIN_DELAY_MS = 300; // small delay on each failure

const failedLoginByIp = new Map<string, LoginThrottleState>();
const failedLoginByEmail = new Map<string, LoginThrottleState>();

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best effort client IP extraction.
 * Respects X-Forwarded-For when behind a proxy.
 */
function getClientIp(req: Request): string {
  const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return xff || req.socket.remoteAddress || "unknown";
}

/**
 * Lightweight identifier hashing for logs.
 * Allows correlating events without logging raw email.
 */
function anonymiseIdentifier(input: string | undefined | null): string | null {
  if (!input) return null;
  return crypto.createHash("sha256").update(input.toLowerCase()).digest("hex").slice(0, 16);
}

function getThrottleState(
  key: string,
  store: Map<string, LoginThrottleState>,
): LoginThrottleState | undefined {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry) return undefined;

  // Reset window if it is too old
  if (now - entry.lastAttempt > FAILED_LOGIN_WINDOW_MS) {
    store.delete(key);
    return undefined;
  }

  return entry;
}

function isThrottled(key: string, store: Map<string, LoginThrottleState>): boolean {
  const entry = getThrottleState(key, store);
  if (!entry) return false;
  if (!entry.blockedUntil) return false;
  return Date.now() < entry.blockedUntil;
}

function registerFailedAttempt(key: string, store: Map<string, LoginThrottleState>): LoginThrottleState {
  const now = Date.now();
  const existing = getThrottleState(key, store);

  if (!existing) {
    const next: LoginThrottleState = { count: 1, lastAttempt: now };
    store.set(key, next);
    return next;
  }

  const nextCount = existing.count + 1;
  const blockedUntil =
    nextCount >= FAILED_LOGIN_MAX_ATTEMPTS
      ? now + FAILED_LOGIN_BLOCK_MS
      : existing.blockedUntil;

  const next: LoginThrottleState = {
    count: nextCount,
    lastAttempt: now,
    blockedUntil,
  };
  store.set(key, next);
  return next;
}

function clearFailedAttempts(key: string, store: Map<string, LoginThrottleState>): void {
  store.delete(key);
}

/**
 * Helper to set the auth cookie
 */
function setAuthCookie(res: Response, token: string) {
  res.cookie("outliers_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    domain: isProduction ? ".outliersmw.com" : undefined,
  });
}

/**
 * Helper to clear the auth cookie
 */
function clearAuthCookie(res: Response) {
  res.clearCookie("outliers_session", {
    path: "/",
    domain: isProduction ? ".outliersmw.com" : undefined,
  });
}

/**
 * POST /v1/auth/signup
 */
export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = getInput<{ body: typeof signupSchema.shape.body }>(res);
    const { orgId, email, password, name } = body!;

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      return res
        .status(400)
        .json({ error: { code: "ORG_NOT_FOUND", message: "Invalid orgId" } });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res
        .status(409)
        .json({ error: { code: "EMAIL_EXISTS", message: "Email already in use" } });
    }

    const passwordHash = await hashPassword(password);

    let orgVerifiedAt: Date | null = null;
    let orgVerificationMethod: OrgVerificationMethod | null = null;
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain) {
      const verifiedDomain = await prisma.organizationDomain.findUnique({
        where: { orgId_domain: { orgId, domain } },
      });
      if (verifiedDomain) {
        orgVerifiedAt = new Date();
        orgVerificationMethod = "DOMAIN";
      }
    }

    const user = await prisma.user.create({
      data: {
        orgId,
        email,
        passwordHash,
        role: Role.USER,
        name,
        orgVerifiedAt,
        orgVerificationMethod,
      },
    });

    const accessToken = signAccessToken({
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      email: user.email,
    });

    return res.status(201).json({
      user: {
        id: user.id,
        orgId: user.orgId,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      accessToken,
      tokenType: "Bearer",
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /v1/auth/login
 * - Verifies credentials
 * - Sets httpOnly cookie "outliers_session"
 * - Returns minimal user payload
 * - Applies simple rate limiting and non verbose errors
 */
export async function login(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIp(req);

  try {
    const { body } = getInput<{ body: typeof loginSchema.shape.body }>(res);
    const { email, password } = body!;
    const emailNorm = email.toLowerCase();
    const emailHash = anonymiseIdentifier(emailNorm);

    // Check if this IP or email is currently throttled
    const ipThrottled = isThrottled(ip, failedLoginByIp);
    const emailThrottled = isThrottled(emailNorm, failedLoginByEmail);
    if (ipThrottled || emailThrottled) {
      logger.warn(
        {
          event: "auth_login_throttled",
          ip,
          emailHash,
        },
        "Throttled login attempt",
      );

      return res.status(429).json({
        error: {
          code: "LOGIN_THROTTLED",
          message: "Too many login attempts. Please try again later.",
        },
      });
    }

    const user = await prisma.user.findUnique({ where: { email: emailNorm } });

    if (!user) {
      // Register failed login without revealing that the user is missing
      const stateIp = registerFailedAttempt(ip, failedLoginByIp);
      const stateEmail = registerFailedAttempt(emailNorm, failedLoginByEmail);

      logger.warn(
        {
          event: "auth_login_failed",
          ip,
          emailHash,
          reason: "unknown_user_or_bad_password",
          ipFailures: stateIp.count,
          emailFailures: stateEmail.count,
        },
        "Failed login attempt",
      );

      await delay(FAILED_LOGIN_DELAY_MS);

      return res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password",
        },
      });
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      const stateIp = registerFailedAttempt(ip, failedLoginByIp);
      const stateEmail = registerFailedAttempt(emailNorm, failedLoginByEmail);

      logger.warn(
        {
          event: "auth_login_failed",
          ip,
          emailHash,
          reason: "bad_password",
          ipFailures: stateIp.count,
          emailFailures: stateEmail.count,
        },
        "Failed login attempt",
      );

      await delay(FAILED_LOGIN_DELAY_MS);

      return res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password",
        },
      });
    }

    // Successful login, clear any previous failure counters
    clearFailedAttempts(ip, failedLoginByIp);
    clearFailedAttempts(emailNorm, failedLoginByEmail);

    const accessToken = signAccessToken({
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      email: user.email,
    });

    setAuthCookie(res, accessToken);

    logger.info(
      {
        event: "auth_login_success",
        ip,
        emailHash,
        userId: user.id,
        orgId: user.orgId,
      },
      "User logged in",
    );

    return res.status(200).json({
      user: {
        id: user.id,
        orgId: user.orgId,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    });
  } catch (err) {
    logger.error(
      {
        event: "auth_login_exception",
        ip,
      },
      "Unexpected error during login",
    );
    return next(err);
  }
}

/**
 * GET /v1/auth/me
 * - Uses req.user (JWT payload) from authenticate middleware
 */
export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const current = req.user as
      | {
          sub: string;
          orgId: string;
          email: string;
          role: string;
        }
      | undefined;

    if (!current?.sub) {
      return res.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required",
        },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: current.sub },
      select: {
        id: true,
        orgId: true,
        email: true,
        role: true,
        createdAt: true,
        name: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required",
        },
      });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        orgId: user.orgId,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        name: user.name,
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /v1/auth/logout
 * - Clears the session cookie
 */
export async function logout(_req: Request, res: Response, next: NextFunction) {
  try {
    clearAuthCookie(res);

    return res.status(200).json({
      success: true,
    });
  } catch (err) {
    return next(err);
  }
}
