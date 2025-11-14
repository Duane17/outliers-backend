// src/controllers/v1/auth.controller.ts
import type { Request, Response, NextFunction } from "express";
import { PrismaClient, OrgVerificationMethod, Role } from "@prisma/client";
import { getInput } from "../../middleware/validate";
import { signupSchema, loginSchema } from "../../schemas/auth";
import { hashPassword, verifyPassword, signAccessToken } from "../../lib/auth";

const prisma = new PrismaClient();
const isProduction = process.env.NODE_ENV === "production";

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
    const { orgId, email, password } = body!;

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
 */
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = getInput<{ body: typeof loginSchema.shape.body }>(res);
    const { email, password } = body!;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password",
        },
      });
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      return res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password",
        },
      });
    }

    const accessToken = signAccessToken({
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      email: user.email,
    });

    setAuthCookie(res, accessToken);

    return res.status(200).json({
      user: {
        id: user.id,
        orgId: user.orgId,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
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
